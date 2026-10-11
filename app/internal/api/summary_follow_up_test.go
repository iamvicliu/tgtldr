package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/fr0der1c/tgtldr/app/internal/clock"
	"github.com/fr0der1c/tgtldr/app/internal/config"
	"github.com/fr0der1c/tgtldr/app/internal/model"
	"github.com/fr0der1c/tgtldr/app/internal/scheduler"
	"github.com/fr0der1c/tgtldr/app/internal/store"
	"github.com/fr0der1c/tgtldr/app/internal/summary"
)

func TestFollowUpRouteRegistration(t *testing.T) {
	// Handler registers both method-qualified patterns and legacy prefix routes.
	r := &Router{}
	if r.Handler() == nil {
		t.Fatal("nil handler")
	}
}

func TestFollowUpRejectsInvalidInput(t *testing.T) {
	for _, tc := range []struct{ id, body string }{{"bad", `{"question":"q"}`}, {"-1", `{"question":"q"}`}, {"1", `{"question":" "}`}, {"1", `{"question":"q","extra":true}`}, {"1", strings.Repeat("x", 1024*1024+1)}} {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
		req.SetPathValue("summaryID", tc.id)
		w := httptest.NewRecorder()
		(&Router{}).handleSummaryFollowUp(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("invalid input status %d", w.Code)
		}
	}
}

func followUpTestStore(t *testing.T) *store.Store {
	t.Helper()
	dsn := os.Getenv("TGTLDR_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires dedicated TGTLDR_TEST_DATABASE_URL")
	}
	cfg := config.Config{DatabaseURL: dsn, MasterKey: make([]byte, 32)}
	admin, err := store.Open(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("follow_up_%d", time.Now().UnixNano())
	if _, err = admin.Pool.Exec(t.Context(), "create schema "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Pool.Exec(context.Background(), "drop schema "+schema+" cascade"); admin.Close() })
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema+",public")
	u.RawQuery = q.Encode()
	cfg.DatabaseURL = u.String()
	st, err := store.Open(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	if err = store.RunMigrations(t.Context(), st); err != nil {
		t.Fatal(err)
	}
	return st
}

func TestFollowUpIntegration(t *testing.T) {
	st := followUpTestStore(t)
	var requestedSource string
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if len(payload.Messages) != 2 {
			t.Error("unexpected messages")
			return
		}
		requestedSource = payload.Messages[1].Content
		fmt.Fprint(w, `{"choices":[{"message":{"content":"evidence answer"}}]}`)
	}))
	defer modelServer.Close()
	settings, err := st.Settings.Get(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	settings.OpenAIBaseURL = modelServer.URL
	settings.OpenAIAPIKey = "test"
	settings.OpenAIModel = "test-model"
	settings.OpenAIRequestMode = model.OpenAIRequestModeNonStream
	settings.Language = model.LanguageEN
	settings.DefaultTimezone = "UTC"
	if _, err = st.Settings.Save(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	_, err = st.Pool.Exec(t.Context(), `insert into chats(id,telegram_chat_id,title,summary_enabled,delivery_mode,filtered_keywords) overriding system value values(1,1,'test',true,'dashboard',ARRAY['excluded']);
 insert into summaries(id,chat_id,summary_date,status,content) overriding system value values(1,1,'2026-10-10','succeeded','saved summary'),(2,1,'2026-10-09','failed',''),(3,1,'2026-10-08','succeeded','empty day summary');
 insert into messages(chat_id,telegram_message_id,text_content,message_time) values(1,1,'evidence message','2026-10-10T08:00:00Z'),(1,2,'excluded message','2026-10-10T09:00:00Z'),(1,3,'next day message','2026-10-11T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	svc := summary.NewService(st, clock.System{}, time.Second)
	sched := scheduler.NewService(st, clock.System{}, svc, nil, nil)
	r := &Router{store: st, scheduler: sched}
	// Select the registered route through ServeMux, bypassing only authentication.
	mux := http.NewServeMux()
	mux.HandleFunc("/api/summaries/", r.handleSummaryByID)
	mux.HandleFunc("POST /api/summaries/{summaryID}/follow-up", r.handleSummaryFollowUp)
	for _, tc := range []struct {
		id     int
		status int
		source string
	}{{1, 200, "messages"}, {3, 200, "summary"}, {2, 400, ""}, {999, 404, ""}} {
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/summaries/%d/follow-up", tc.id), strings.NewReader(`{"question":"what happened?"}`))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("id %d status %d: %s", tc.id, w.Code, w.Body.String())
		}
		if tc.status == 200 {
			var answer summary.FollowUpAnswer
			if err := json.Unmarshal(w.Body.Bytes(), &answer); err != nil {
				t.Fatal(err)
			}
			if answer.Answer != "evidence answer" || answer.Source != tc.source {
				t.Fatalf("answer %+v", answer)
			}
			if tc.id == 1 && (!strings.Contains(requestedSource, "evidence message") || strings.Contains(requestedSource, "excluded message") || strings.Contains(requestedSource, "next day message")) {
				t.Fatal("filter or date range not preserved")
			}
		}
	}
	item, err := st.Summaries.GetByID(t.Context(), 1)
	if err != nil {
		t.Fatal(err)
	}
	preview, err := svc.BuildContextPreview(t.Context(), item)
	if err != nil || preview.MessageCount != 1 || len(preview.Chunks) != 1 || !strings.Contains(preview.Chunks[0].Content, "evidence message") || strings.Contains(preview.Chunks[0].Content, "excluded message") {
		t.Fatalf("preview changed: %+v %v", preview, err)
	}
	// Weekly and monthly summaries load the entire configured period.
	for _, tc := range []struct {
		frequency             model.SummaryFrequency
		date, inside, outside string
	}{
		{model.SummaryFrequencyWeekly, "2026-10-05", "2026-10-11T10:00:00Z", "2026-10-12T00:00:00Z"},
		{model.SummaryFrequencyMonthly, "2026-09-01", "2026-09-30T10:00:00Z", "2026-10-01T00:00:00Z"},
	} {
		if _, err = st.Pool.Exec(t.Context(), "update chats set summary_frequency=$1 where id=1", tc.frequency); err != nil {
			t.Fatal(err)
		}
		if _, err = st.Pool.Exec(t.Context(), "insert into messages(chat_id,telegram_message_id,text_content,message_time) values(1,10,'period evidence',$1::timestamptz),(1,11,'outside evidence',$2::timestamptz)", tc.inside, tc.outside); err != nil {
			t.Fatal(err)
		}
		item.SummaryDate = tc.date
		answer, err := svc.AskFollowUp(t.Context(), item, "what happened?", nil)
		if err != nil || answer.Source != "messages" || !strings.Contains(requestedSource, "period evidence") || strings.Contains(requestedSource, "outside evidence") {
			t.Fatalf("period %s: %+v %v", tc.frequency, answer, err)
		}
		if !strings.Contains(requestedSource, model.SummaryPeriodEndDate(tc.date, tc.frequency)) {
			t.Fatal("period end missing from prompt")
		}
		preview, err := svc.BuildContextPreview(t.Context(), item)
		if err != nil || len(preview.Chunks) != 1 || !strings.Contains(preview.Chunks[0].Content, "period evidence") || strings.Contains(preview.Chunks[0].Content, "outside evidence") {
			t.Fatalf("period preview: %+v %v", preview, err)
		}
		if _, err = st.Pool.Exec(t.Context(), "delete from messages where telegram_message_id in (10,11)"); err != nil {
			t.Fatal(err)
		}
	}

}
