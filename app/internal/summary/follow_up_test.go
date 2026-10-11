package summary

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode"

	"github.com/fr0der1c/tgtldr/app/internal/model"
)

func TestFollowUpValidation(t *testing.T) {
	for _, q := range []string{"", "  ", strings.Repeat("字", 2001)} {
		if _, _, err := NormalizeFollowUp(q, nil); !errors.Is(err, ErrInvalidFollowUp) {
			t.Fatalf("invalid question accepted: %v", err)
		}
	}
	history := make([]FollowUpTurn, 8)
	for i := range history {
		history[i] = FollowUpTurn{Question: fmt.Sprintf("q%d", i), Answer: "answer"}
	}
	q, turns, err := NormalizeFollowUp(" question ", history)
	if err != nil || q != "question" || len(turns) != 6 || turns[0].Question != "q2" {
		t.Fatalf("normalization: %q %+v %v", q, turns, err)
	}
	if _, _, err := NormalizeFollowUp("ok", []FollowUpTurn{{Question: "q"}}); !errors.Is(err, ErrInvalidFollowUp) {
		t.Fatal("accepted empty history answer")
	}
	if _, _, err := NormalizeFollowUp(strings.Repeat("字", 2000), nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := NormalizeFollowUp("next", []FollowUpTurn{{Question: "previous", Answer: strings.Repeat("a", 32001)}}); err != nil {
		t.Fatalf("rejected valid long model answer: %v", err)
	}

	if _, err := (&Service{}).AskFollowUp(t.Context(), model.Summary{Status: model.SummaryStatusFailed}, "q", nil); !errors.Is(err, ErrInvalidFollowUp) {
		t.Fatal("accepted failed summary")
	}
}

func TestFollowUpPrompts(t *testing.T) {
	for _, language := range []model.Language{model.LanguageEN, model.LanguageZhCN} {
		p := followUpSystemPrompt(language) + buildFollowUpPrompt(language, "2026-10-10", "summary", "source", "question", []FollowUpTurn{{Question: "old question", Answer: "old answer"}})
		for _, text := range []string{"source", "question", "old answer", "2026-10-10"} {
			if !strings.Contains(p, text) {
				t.Fatal("prompt missing", text)
			}
		}
		if language == model.LanguageEN {
			for _, r := range p {
				if unicode.Is(unicode.Han, r) {
					t.Fatal("English prompt has Chinese labels")
				}
			}
		} else if !strings.Contains(p, "摘要内容") || !strings.Contains(p, "对话历史") {
			t.Fatal("Chinese labels missing")
		}
	}
}

func TestFollowUpSourceBudget(t *testing.T) {
	settings := dailyTestSettings("unused")
	settings.OpenAIContextWindowTokens = 8000
	system := followUpSystemPrompt(settings.Language)
	budget := resolveSummaryBudget(settings, settings.OpenAIModel, system)
	item := model.Summary{SummaryDate: "2026-10-10", Content: "short summary"}
	for _, tc := range []struct{ transcript, source string }{{"short messages", "messages"}, {strings.Repeat("long transcript ", 10000), "summary"}, {"", "summary"}} {
		prompt, source, err := planFollowUp(settings.Language, item, tc.transcript, "q", nil, system, budget)
		if err != nil || source != tc.source || prompt == "" {
			t.Fatalf("source %s: %s %v", tc.source, source, err)
		}
	}
	item.Content = strings.Repeat("long summary ", 10000)
	if _, _, err := planFollowUp(settings.Language, item, "", "q", nil, system, budget); !errors.Is(err, ErrFollowUpContextLimit) {
		t.Fatal("oversized source accepted")
	}
	item.Content = "small"
	history := []FollowUpTurn{{Question: "q", Answer: strings.Repeat("history ", 10000)}}
	if _, _, err := planFollowUp(settings.Language, item, "messages", "q", history, system, budget); !errors.Is(err, ErrFollowUpContextLimit) {
		t.Fatal("history not counted in budget")
	}
}

func TestFollowUpModelRequest(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload struct {
					Model     string `json:"model"`
					Stream    bool   `json:"stream"`
					MaxOutput int    `json:"max_completion_tokens"`
					Messages  []struct {
						Content string `json:"content"`
					} `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				if payload.Stream != stream || payload.Model != "override-model" || payload.MaxOutput != 512 {
					t.Errorf("config ignored: %+v", payload)
				}
				if len(payload.Messages) != 2 || !strings.Contains(payload.Messages[1].Content, "old answer") {
					t.Error("missing history")
				}
				if stream {
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\ndata: [DONE]\n\n")
				} else {
					fmt.Fprint(w, `{"choices":[{"message":{"content":"answer"}}]}`)
				}
			}))
			defer server.Close()
			settings := dailyTestSettings(server.URL)
			settings.Language = model.LanguageEN
			settings.OpenAIOutputMode = model.OutputModeManual
			settings.OpenAIMaxOutputToken = 512
			if stream {
				settings.OpenAIRequestMode = model.OpenAIRequestModeStream
			}
			result, err := (&Service{openAITimeout: time.Second}).answerFollowUp(t.Context(), settings, model.Chat{ModelOverride: "override-model"}, model.Summary{Content: "summary", SummaryDate: "2026-10-10"}, "messages", "question", []FollowUpTurn{{Question: "old question", Answer: "old answer"}})
			if err != nil || result.Answer != "answer" || result.Source != "messages" {
				t.Fatalf("answer: %+v %v", result, err)
			}
		})
	}
}
