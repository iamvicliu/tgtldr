package summary

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fr0der1c/tgtldr/app/internal/clock"
	"github.com/fr0der1c/tgtldr/app/internal/llmcontext"
	"github.com/fr0der1c/tgtldr/app/internal/model"
	"github.com/fr0der1c/tgtldr/app/internal/openai"
	"github.com/fr0der1c/tgtldr/app/internal/store"
)

type Service struct {
	store         *store.Store
	clock         clock.Clock
	openAITimeout time.Duration
}

func NewService(st *store.Store, c clock.Clock, openAITimeout time.Duration) *Service {
	return &Service{store: st, clock: c, openAITimeout: openAITimeout}
}

func (s *Service) BuildContextPreview(ctx context.Context, summary model.Summary) (model.SummaryContextPreview, error) {
	loaded, err := s.loadSummaryMessages(ctx, summary)
	if err != nil {
		return model.SummaryContextPreview{}, err
	}
	settings, chat, location := loaded.settings, loaded.chat, loaded.location
	filteredMessages, messageLookup := loaded.messages, loaded.lookup
	stagePrompt := buildStagePrompt(settings.Language, chat.SummaryContext, chat.SummaryPrompt)
	finalPrompt := buildFinalPrompt(settings.Language, chat.SummaryContext, chat.SummaryPrompt)
	modelName := resolveSummaryModel(chat, settings)
	budget := resolveSummaryBudget(settings, modelName, stagePrompt)
	fullTranscript := BuildTranscript(filteredMessages, messageLookup, location, settings.Language)
	directPlan := llmcontext.PlanRequest(budget.Counter, budget.ContextWindow, finalPrompt, fullTranscript, budget.FinalReserve)
	chunks := SplitMessagesWithCounter(filteredMessages, budget.ChunkTokenBudget, budget.Counter)
	directMode := len(filteredMessages) > 0 && directPlan.Fits
	if directMode {
		chunks = []Chunk{{Index: 0, Messages: filteredMessages}}
		stagePrompt = finalPrompt
		finalPrompt = ""
	}
	preview := model.SummaryContextPreview{
		SummaryID:        summary.ID,
		ChatID:           summary.ChatID,
		SummaryDate:      summary.SummaryDate,
		Model:            modelName,
		SystemPrompt:     stagePrompt,
		FinalPrompt:      finalPrompt,
		MessageCount:     len(filteredMessages),
		ChunkCount:       len(chunks),
		Chunks:           []model.SummaryContextChunk{},
		FinalInputNotice: finalInputNotice(settings.Language),
		PreviewNotice:    previewNotice(settings.Language),
	}

	for _, chunk := range chunks {
		preview.Chunks = append(preview.Chunks, model.SummaryContextChunk{
			Index:        chunk.Index,
			MessageCount: len(chunk.Messages),
			Content:      BuildTranscript(chunk.Messages, messageLookup, location, settings.Language),
		})
	}
	if directMode || len(chunks) == 0 {
		preview.FinalPrompt = ""
		preview.FinalInputNotice = ""
	}
	return preview, nil
}

type summaryMessages struct {
	settings model.AppSettings
	chat     model.Chat
	location *time.Location
	messages []model.Message
	lookup   map[int]model.Message
}

func (s *Service) loadSummaryMessages(ctx context.Context, summary model.Summary) (summaryMessages, error) {
	settings, err := s.store.Settings.Get(ctx)
	if err != nil {
		return summaryMessages{}, err
	}

	chat, err := s.store.Chats.GetByID(ctx, summary.ChatID)
	if err != nil {
		return summaryMessages{}, err
	}

	timezone := resolveSummaryTimezone(chat, settings.DefaultTimezone)
	location, err := loadLocation(timezone)
	if err != nil {
		return summaryMessages{}, err
	}
	start, end, err := periodRange(summary.SummaryDate, timezone, chat.SummaryFrequency)
	if err != nil {
		return summaryMessages{}, err
	}

	messages, err := s.store.Messages.ListForRange(ctx, chat.ID, start, end)
	if err != nil {
		return summaryMessages{}, err
	}

	filteredMessages, messageLookup, err := s.prepareMessages(ctx, chat, messages)
	if err != nil {
		return summaryMessages{}, err
	}
	return summaryMessages{settings, chat, location, filteredMessages, messageLookup}, nil
}

func (s *Service) RunDailySummary(ctx context.Context, chat model.Chat, date string) (model.Summary, error) {
	settings, err := s.store.Settings.Get(ctx)
	if err != nil {
		return model.Summary{}, err
	}

	timezone := resolveSummaryTimezone(chat, settings.DefaultTimezone)
	location, err := loadLocation(timezone)
	if err != nil {
		return model.Summary{}, err
	}
	start, end, err := periodRange(date, timezone, chat.SummaryFrequency)
	if err != nil {
		return model.Summary{}, err
	}

	messages, err := s.store.Messages.ListForRange(ctx, chat.ID, start, end)
	if err != nil {
		return model.Summary{}, err
	}
	filteredMessages, messageLookup, err := s.prepareMessages(ctx, chat, messages)
	if err != nil {
		return model.Summary{}, err
	}

	summary := model.Summary{
		ChatID:             chat.ID,
		SummaryDate:        date,
		Status:             model.SummaryStatusSucceeded,
		Model:              resolveSummaryModel(chat, settings),
		RequestedModel:     resolveSummaryModel(chat, settings),
		SourceMessageCount: len(filteredMessages),
		GeneratedAt:        s.clock.Now(),
	}
	if len(filteredMessages) == 0 {
		summary.Content = emptySummaryContent(settings.Language)
		return summary, nil
	}

	return s.generateDailySummary(ctx, settings, chat, location, filteredMessages, messageLookup, summary)
}

func resolveSummaryModel(chat model.Chat, settings model.AppSettings) string {
	if strings.TrimSpace(chat.ModelOverride) != "" {
		return strings.TrimSpace(chat.ModelOverride)
	}
	return settings.OpenAIModel
}

func resolveSummaryTimezone(chat model.Chat, fallback string) string {
	if timezone := strings.TrimSpace(chat.SummaryTimezone); timezone != "" {
		return timezone
	}
	if timezone := strings.TrimSpace(fallback); timezone != "" {
		return timezone
	}
	return time.Local.String()
}

type openAIRequestContextInput struct {
	Stage        string
	ChunkIndex   *int
	BaseURL      string
	Model        string
	Temperature  float64
	MaxOutput    int
	SystemPrompt string
	UserPrompt   string
}

type openAIRequestContextPayload struct {
	Stage       string  `json:"stage"`
	ChunkIndex  *int    `json:"chunkIndex,omitempty"`
	BaseURL     string  `json:"baseURL"`
	Model       string  `json:"model"`
	Temperature float64 `json:"temperature"`
	MaxOutput   int     `json:"maxOutput"`
}

type openAIRequestSnapshot struct {
	Context      string
	SystemPrompt string
	UserPrompt   string
}

func buildOpenAIRequestSnapshot(input openAIRequestContextInput) openAIRequestSnapshot {
	payload := openAIRequestContextPayload{
		Stage:       input.Stage,
		ChunkIndex:  input.ChunkIndex,
		BaseURL:     input.BaseURL,
		Model:       input.Model,
		Temperature: input.Temperature,
		MaxOutput:   input.MaxOutput,
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return openAIRequestSnapshot{
			SystemPrompt: input.SystemPrompt,
			UserPrompt:   input.UserPrompt,
		}
	}
	return openAIRequestSnapshot{
		Context:      string(encoded),
		SystemPrompt: input.SystemPrompt,
		UserPrompt:   input.UserPrompt,
	}
}

type openAIRequestError struct {
	err             error
	requestSnapshot openAIRequestSnapshot
}

func (e *openAIRequestError) Error() string {
	return e.err.Error()
}

func (e *openAIRequestError) Unwrap() error {
	return e.err
}

func wrapOpenAIRequestError(err error, requestSnapshot openAIRequestSnapshot) error {
	if err == nil {
		return nil
	}
	return &openAIRequestError{
		err:             err,
		requestSnapshot: requestSnapshot,
	}
}

func openAIErrorContext(err error) string {
	var requestErr *openAIRequestError
	if errors.As(err, &requestErr) {
		return requestErr.requestSnapshot.Context
	}
	return ""
}

func openAIErrorSystemPrompt(err error) string {
	var requestErr *openAIRequestError
	if errors.As(err, &requestErr) {
		return requestErr.requestSnapshot.SystemPrompt
	}
	return ""
}

func openAIErrorUserPrompt(err error) string {
	var requestErr *openAIRequestError
	if errors.As(err, &requestErr) {
		return requestErr.requestSnapshot.UserPrompt
	}
	return ""
}

func openAIErrorRetryable(err error) bool {
	var requestErr *openAIRequestError
	return errors.As(err, &requestErr) && openai.IsRetryableError(requestErr.err)
}

func loadLocation(timezone string) (*time.Location, error) {
	if strings.TrimSpace(timezone) == "" {
		return time.Local, nil
	}

	location, err := time.LoadLocation(timezone)
	if err != nil {
		return nil, fmt.Errorf("load location %s: %w", timezone, err)
	}
	return location, nil
}

func dayRange(date string, timezone string) (time.Time, time.Time, error) {
	location, err := loadLocation(timezone)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	start, err := time.ParseInLocation("2006-01-02", date, location)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("parse date %s: %w", date, err)
	}
	end := start.Add(24 * time.Hour)
	return start.UTC(), end.UTC(), nil
}

// periodRange 返回摘要周期的消息时间范围；按周或按月的群组以 date 为周期首日。
func periodRange(date string, timezone string, frequency model.SummaryFrequency) (time.Time, time.Time, error) {
	start, end, err := dayRange(date, timezone)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	endDate := model.SummaryPeriodEndDate(date, frequency)
	if endDate == date {
		return start, end, nil
	}
	_, end, err = dayRange(endDate, timezone)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return start, end, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (s *Service) prepareMessages(ctx context.Context, chat model.Chat, messages []model.Message) ([]model.Message, map[int]model.Message, error) {
	lookup := make(map[int]model.Message, len(messages))
	for _, message := range messages {
		lookup[message.TelegramMessageID] = message
	}

	missingReplyIDs := make([]int, 0)
	for _, message := range messages {
		if message.ReplyToMessageID == 0 {
			continue
		}
		if _, ok := lookup[message.ReplyToMessageID]; ok {
			continue
		}
		missingReplyIDs = append(missingReplyIDs, message.ReplyToMessageID)
	}

	if len(missingReplyIDs) > 0 && s.store != nil && s.store.Messages != nil {
		referenced, err := s.store.Messages.LookupByTelegramIDs(ctx, chat.ID, uniqueInts(missingReplyIDs))
		if err != nil {
			return nil, nil, err
		}
		for messageID, message := range referenced {
			lookup[messageID] = message
		}
	}

	filtered := make([]model.Message, 0, len(messages))
	for _, message := range messages {
		if shouldSkipMessage(message, chat) {
			continue
		}
		if strings.TrimSpace(message.SummaryText()) == "" {
			continue
		}
		filtered = append(filtered, message)
	}
	return filtered, lookup, nil
}

func shouldSkipMessage(message model.Message, chat model.Chat) bool {
	if !chat.KeepBotMessages && message.SenderIsBot {
		return true
	}
	if matchesFilteredSender(message, chat.FilteredSenders) {
		return true
	}
	return matchesFilteredKeyword(message, chat.FilteredKeywords)
}

func matchesFilteredSender(message model.Message, filters []string) bool {
	if len(filters) == 0 {
		return false
	}

	name := normalizeFilterToken(message.SenderName)
	username := normalizeFilterToken(message.SenderUsername)

	for _, filter := range filters {
		target := normalizeFilterToken(filter)
		if target == "" {
			continue
		}
		if target == name || target == username {
			return true
		}
		if strings.HasPrefix(target, "@") && strings.TrimPrefix(target, "@") == username {
			return true
		}
	}
	return false
}

func matchesFilteredKeyword(message model.Message, filters []string) bool {
	if len(filters) == 0 {
		return false
	}

	text := normalizeFilterToken(message.SummaryText())
	if text == "" {
		return false
	}

	for _, filter := range filters {
		target := normalizeFilterToken(filter)
		if target == "" {
			continue
		}
		if strings.Contains(text, target) {
			return true
		}
	}
	return false
}

func normalizeFilterToken(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	return strings.ToLower(trimmed)
}

func uniqueInts(values []int) []int {
	if len(values) == 0 {
		return nil
	}

	seen := make(map[int]struct{}, len(values))
	out := make([]int, 0, len(values))
	for _, value := range values {
		if value == 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

const maxChatFollowUpChars = 150_000

// AskChatFollowUp 针对某群组一段时间内的历史摘要合集追问，支持多轮对话历史。
func (s *Service) AskChatFollowUp(ctx context.Context, chatID int64, question string, history []FollowUpTurn, dateFrom, dateTo string) (string, error) {
	settings, err := s.store.Settings.Get(ctx)
	if err != nil {
		return "", fmt.Errorf("load settings: %w", err)
	}

	chat, err := s.store.Chats.GetByID(ctx, chatID)
	if err != nil {
		return "", fmt.Errorf("load chat: %w", err)
	}

	result, err := s.store.Summaries.Search(ctx, store.SummaryListParams{
		ChatID:   chatID,
		Status:   "succeeded",
		DateFrom: dateFrom,
		DateTo:   dateTo,
		PageSize: 100,
		Page:     1,
	})
	if err != nil {
		return "", fmt.Errorf("load summaries: %w", err)
	}
	if len(result.Items) == 0 {
		if settings.Language == model.LanguageEN {
			return "", fmt.Errorf("no summaries available for this chat, please generate summaries first")
		}
		return "", fmt.Errorf("该群暂无可用的历史摘要，请先生成摘要后再追问")
	}

	var contextBuf strings.Builder
	included := 0
	for _, item := range result.Items {
		if item.Content == "" {
			continue
		}
		section := fmt.Sprintf("=== %s ===\n%s\n\n", item.SummaryDate, item.Content)
		if contextBuf.Len()+len(section) > maxChatFollowUpChars {
			break
		}
		contextBuf.WriteString(section)
		included++
	}

	if contextBuf.Len() == 0 {
		if settings.Language == model.LanguageEN {
			return "", fmt.Errorf("no usable summary content found")
		}
		return "", fmt.Errorf("没有可用的摘要内容")
	}

	client := openai.New(openai.Config{
		BaseURL: settings.OpenAIBaseURL,
		APIKey:  settings.OpenAIAPIKey,
		Model:   resolveSummaryModel(chat, settings),
		Timeout: s.openAITimeout,
	})

	var systemPrompt string
	if settings.Language == model.LanguageEN {
		systemPrompt = "You are a helpful assistant. You will be given daily summaries of a group chat, arranged from most recent to oldest. Answer the user's question based on these summaries. Be concise and accurate. The conversation history below shows previous questions and answers in this session."
	} else {
		systemPrompt = "你是一个有帮助的助手。你将收到一个群聊的每日摘要合集（按日期从最近到最远排列），请根据这些摘要内容回答用户的问题。回答要简洁准确。以下对话历史是本次会话中之前的问答，可以作为上下文参考。"
	}

	var historySection strings.Builder
	for _, turn := range history {
		historySection.WriteString(fmt.Sprintf("问：%s\n答：%s\n\n", turn.Question, turn.Answer))
	}

	var userPrompt string
	if historySection.Len() > 0 {
		userPrompt = fmt.Sprintf("群聊历史摘要（共 %d 条）：\n\n%s\n\n对话历史：\n%s问题：%s", included, contextBuf.String(), historySection.String(), question)
	} else {
		userPrompt = fmt.Sprintf("群聊历史摘要（共 %d 条）：\n\n%s\n\n问题：%s", included, contextBuf.String(), question)
	}

	resp, err := client.Chat(ctx, openai.ChatRequest{
		SystemPrompt: systemPrompt,
		UserPrompt:   userPrompt,
		Temperature:  settings.OpenAITemperature,
	})
	if err != nil {
		return "", err
	}
	return resp.Content, nil
}
