"use client";

import { startTransition, useEffect, useState } from "react";
import { Drawer } from "@/components/drawer";
import { EmptyState } from "@/components/dashboard-page";
import { FollowUpConversation, followUpQuestionLimit } from "@/components/follow-up-conversation";
import { SummaryFollowUp } from "@/components/summary-follow-up";
import { SummaryMarkdown } from "@/components/summary-markdown";
import { Button, StatusPill } from "@/components/ui";
import { Chat, Summary } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { summaryModelLabel } from "@/lib/summary-model";
import { deliveryState, statusText, statusTone } from "@/components/summaries-panel-sections";
import { api } from "@/lib/api";

export function SummaryDetailDrawer({
  active,
  botReady,
  chatTitle,
  emptyDescription = "从列表中选择一条摘要后，这里会展示完整正文。",
  emptyTitle = "没有可查看的摘要",
  loading = false,
  onClose,
  onOpenContext,
  onRerunSummary,
  onRetryDelivery,
  open,
  selectedChat,
  selectedSummary,
  summaryRetryLimit
}: {
  active: boolean;
  botReady: boolean;
  chatTitle: string;
  emptyDescription?: string;
  emptyTitle?: string;
  loading?: boolean;
  onClose: () => void;
  onOpenContext: () => void;
  onRerunSummary: (summary: Summary) => Promise<void>;
  onRetryDelivery: (summary: Summary) => Promise<void>;
  open: boolean;
  selectedChat: Chat | null;
  selectedSummary: Summary | null;
  summaryRetryLimit: number;
}) {
  const { language } = useI18n();
  const [followUpRevision, setFollowUpRevision] = useState(0);
  const selectedDelivery = selectedSummary
    ? deliveryState(selectedSummary, selectedChat, botReady)
    : null;

  return (
    <Drawer active={active} onClose={onClose} open={open}>
      {loading ? (
        <p className="muted">正在读取摘要…</p>
      ) : !selectedSummary ? (
        <EmptyState
          description={emptyDescription}
          title={emptyTitle}
        />
      ) : (
        <div className="summary-detail-stack">
          <div className="summary-detail-header">
            <h2>
              {chatTitle} · {selectedSummary.summaryDate}
            </h2>
          </div>
          <div className="summary-status-actions">
            <StatusPill tone={statusTone(selectedSummary.status)}>
              {statusText(selectedSummary.status)}
            </StatusPill>
            <StatusPill
              className={selectedDelivery?.detail ? "status-pill-hoverable" : undefined}
              title={selectedDelivery?.detail}
              tone={selectedDelivery?.tone ?? "neutral"}
            >
              {selectedDelivery?.label ?? "不发送"}
            </StatusPill>
            {selectedDelivery?.retryable ? (
              <button
                className="text-link-button summary-delivery-link"
                onClick={() => startTransition(() => void onRetryDelivery(selectedSummary))}
                type="button"
              >
                通过 Bot 发送
              </button>
            ) : null}
          </div>
          <div className="summary-detail-meta">
            <p>
              {summaryModelLabel(selectedSummary, language)} · 消息 {selectedSummary.sourceMessageCount} 条 · 分块{" "}
              {selectedSummary.chunkCount}
            </p>
            <div className="summary-detail-meta-actions">
              <button className="text-link-button" onClick={onOpenContext} type="button">
                查看原始 prompt
              </button>
              <button
                className="text-link-button"
                onClick={() => {
                  setFollowUpRevision((revision) => revision + 1);
                  startTransition(() => void onRerunSummary(selectedSummary));
                }}
                type="button"
              >
                重新生成
              </button>
            </div>
          </div>
          <SummaryContent summary={selectedSummary} summaryRetryLimit={summaryRetryLimit} />
          {open ? (
            <FollowUpFooter
              key={`${selectedSummary.id}:${selectedSummary.generatedAt}:${followUpRevision}`}
              chatId={selectedSummary.chatId}
              summary={selectedSummary}
            />
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

function SummaryContent({
  summary,
  summaryRetryLimit,
}: {
  summary: Summary;
  summaryRetryLimit: number;
}) {
  if (summary.status === "failed") {
    return (
      <div className="summary-context-stack">
        <RetryStatus summary={summary} summaryRetryLimit={summaryRetryLimit} />
        <div>
          <p className="muted">服务器返回错误</p>
          <pre className="summary-context-block">{summary.errorMessage || ""}</pre>
        </div>
        {summary.errorContext ? (
          <CopyableContextBlock title="OpenAI 请求参数" value={summary.errorContext} />
        ) : null}
        {summary.errorSystemPrompt ? (
          <CopyableContextBlock title="System prompt" value={summary.errorSystemPrompt} />
        ) : null}
        {summary.errorUserPrompt ? (
          <CopyableContextBlock title="User prompt" value={summary.errorUserPrompt} />
        ) : null}
      </div>
    );
  }

  if (!summary.content) {
    return (
      <EmptyState
        description="这条摘要还没有正文，请稍后重试或重新生成。"
        title="还没有摘要内容"
      />
    );
  }

  return (
    <div className="summary-detail-content">
      <SummaryMarkdown content={summary.content} />
    </div>
  );
}

function RetryStatus({
  summary,
  summaryRetryLimit,
}: {
  summary: Summary;
  summaryRetryLimit: number;
}) {
  const retryCount = summary.retryCount || 0;
  const limitLabel =
    summaryRetryLimit > 0 ? `${retryCount} / ${summaryRetryLimit}` : `${retryCount} / 0`;
  let detail = "未安排自动重试。";
  if (summary.nextRetryAt) {
    detail = `下次自动重试：${formatRetryTime(summary.nextRetryAt)}`;
  } else if (summaryRetryLimit > 0 && retryCount >= summaryRetryLimit) {
    detail = "已达到自动重试上限。";
  } else if (summaryRetryLimit === 0) {
    detail = "自动重试已关闭。";
  }

  return (
    <div className="summary-retry-status">
      <p>已自动重试 {limitLabel}</p>
      <span>{detail}</span>
    </div>
  );
}

function formatRetryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

type QAPair = { question: string; answer: string | null };

function FollowUpFooter({ chatId, summary }: { chatId: number; summary: Summary }) {
  const [mode, setMode] = useState<"summary" | "chat">(summary.status === "succeeded" ? "summary" : "chat");

  return (
    <div className="followup-box">
      <p className="followup-label">继续追问：</p>
      <div className="followup-tabs">
        {summary.status === "succeeded" ? <button
          className={`followup-tab${mode === "summary" ? " followup-tab--active" : ""}`}
          onClick={() => setMode("summary")}
          type="button"
        >
          追问这条摘要
        </button> : null}
        <button
          className={`followup-tab${mode === "chat" ? " followup-tab--active" : ""}`}
          onClick={() => setMode("chat")}
          type="button"
        >
          追问整个群
        </button>
      </div>
      {mode === "summary" && summary.status === "succeeded" ? (
        <SummaryFollowUp summaryId={summary.id} />
      ) : (
        <ChatFollowUpBox chatId={chatId} />
      )}
    </div>
  );
}

const CHAT_STORAGE_KEY = (id: number) => `chat_followup_${id}`;

function ChatFollowUpBox({ chatId }: { chatId: number }) {
  const [pairs, setPairs] = useState<QAPair[]>(() => {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY(chatId));
      return saved ? (JSON.parse(saved) as QAPair[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const toSave = pairs.filter((p) => p.answer !== null);
      localStorage.setItem(CHAT_STORAGE_KEY(chatId), JSON.stringify(toSave));
    } catch {}
  }, [pairs, chatId]);

  async function submit() {
    const q = input.trim();
    if (!q || loading || Array.from(input).length > followUpQuestionLimit) return;
    setLoading(true);
    setError(null);

    const history = pairs
      .filter((p) => p.answer !== null)
      .map((p) => ({ question: p.question, answer: p.answer as string }));

    setPairs((prev) => [...prev, { question: q, answer: null }]);

    try {
      const { answer } = await api.askChatFollowUp(chatId, q, history);
      setInput("");
      setPairs((prev) =>
        prev.map((p, i) => (i === prev.length - 1 ? { ...p, answer } : p))
      );
    } catch (e) {
      setPairs((prev) => prev.slice(0, -1));
      setError(e instanceof Error ? e.message : "请求失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <FollowUpConversation
      turns={pairs}
      question={input}
      onQuestionChange={setInput}
      onSubmit={() => void submit()}
      loading={loading}
      error={error}
      description="基于该群历史摘要回答，对话保存在当前浏览器。"
    />
  );
}

function CopyableContextBlock({ title, value }: { title: string; value: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    try {
      await copyTextToClipboard(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1500);
  }

  return (
    <div className="summary-error-context-section">
      <div className="summary-error-context-head">
        <p className="muted">{title}</p>
        <button className="text-link-button" onClick={handleCopy} type="button">
          {copyButtonLabel(copyState)}
        </button>
      </div>
      <pre className="summary-context-block summary-error-context-block">{value}</pre>
    </div>
  );
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy command failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

function copyButtonLabel(state: "idle" | "copied" | "failed") {
  if (state === "copied") {
    return "已复制";
  }
  if (state === "failed") {
    return "复制失败";
  }
  return "复制";
}
