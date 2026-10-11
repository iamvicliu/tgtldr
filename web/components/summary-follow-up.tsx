"use client";

import { FormEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { SummaryMarkdown } from "@/components/summary-markdown";
import { APIError, api } from "@/lib/api";
import { translateText, useI18n } from "@/lib/i18n";
import { SummaryFollowUpResponse, SummaryFollowUpTurn } from "@/lib/types";

const questionLimit = 2000;
const historyLimit = 6;
type Turn = SummaryFollowUpTurn & Pick<SummaryFollowUpResponse, "source">;

export function SummaryFollowUp({ summaryId }: { summaryId: number }) {
  const { language } = useI18n();
  const t = (text: string) => translateText(text, language);
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const characterCount = Array.from(question).length;
  const tooLong = characterCount > questionLimit;

  useLayoutEffect(() => () => controller.current?.abort(), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (!submittedQuestion || tooLong || controller.current) {
      return;
    }
    const pending = new AbortController();
    controller.current = pending;
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await api.followUpSummary(
        summaryId,
        submittedQuestion,
        turns.slice(-historyLimit).map(({ question, answer }) => ({ question, answer })),
        pending.signal,
      );
      if (!pending.signal.aborted) {
        setTurns((previous) => [...previous, { question: submittedQuestion, ...response }]);
        setQuestion("");
      }
    } catch (error) {
      if (!pending.signal.aborted) {
        setErrorMessage(error instanceof APIError && error.code === "follow_up_context_limit"
          ? "问题或对话超出模型容量，请缩短问题或关闭详情后重新开始。"
          : "追问失败，请稍后重新发送。");
      }
    } finally {
      if (!pending.signal.aborted) {
        controller.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <section className="summary-context-section summary-follow-up" aria-label={t("追问这条摘要")}>
      <div className="summary-context-head">
        <div>
          <h3>{t("追问这条摘要")}</h3>
          <p className="muted">{t("仅针对当天内容追问；关闭详情后清空对话。")}</p>
        </div>
      </div>
      {turns.map((turn, index) => (
        <div className="summary-follow-up-turn" key={index}>
          <p className="summary-follow-up-question">{turn.question}</p>
          <p className="muted">
            {t(turn.source === "messages"
              ? "回答依据：当天原始消息。"
              : "回答依据：摘要。原始消息不可用或超出模型容量，细节可能不完整。")}
          </p>
          <SummaryMarkdown content={turn.answer} />
        </div>
      ))}
      <form className="summary-follow-up-form" onSubmit={handleSubmit}>
        <label htmlFor={inputId}>{t("你的问题")}</label>
        <textarea
          aria-describedby={`${inputId}-limit`}
          aria-invalid={tooLong || undefined}
          className="textarea"
          disabled={loading}
          id={inputId}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("例如：这条结论有哪些具体依据？")}
          rows={3}
          value={question}
        />
        <div className="summary-follow-up-actions">
          <span className="muted" id={`${inputId}-limit`}>
            {characterCount} / {questionLimit} · {t("最多 2000 个字符")}
          </span>
          <button className="button primary" disabled={loading || tooLong || !question.trim()} type="submit">
            {t(loading ? "正在回答…" : "发送问题")}
          </button>
        </div>
        {tooLong ? <p role="alert">{t("问题不能超过 2000 个字符。")}</p> : null}
        {errorMessage ? <p role="alert">{t(errorMessage)}</p> : null}
        <span className="muted" role="status">{loading ? t("正在回答…") : ""}</span>
      </form>
    </section>
  );
}
