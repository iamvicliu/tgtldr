"use client";

import { startTransition, useMemo, useState } from "react";
import { AppSelect } from "@/components/app-select";
import { SearchSelect } from "@/components/search-select";
import {
	EmptyState,
	Surface,
} from "@/components/dashboard-page";
import { Button, Field, Input, StatusPill } from "@/components/ui";
import { TextHighlight } from "@/components/text-highlight";
import { Chat, Summary } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { summaryModelLabel } from "@/lib/summary-model";

export type SummaryFilter = "all" | "processing" | Summary["status"];
export type DeliveryFilter = "all" | "sent" | "pending" | "failed" | "disabled";
export type DeliveryTone = "neutral" | "good" | "warn" | "bad";
export type DeliveryState = {
	label: string;
	tone: DeliveryTone;
	detail?: string;
	retryable: boolean;
};

type SummaryListSectionProps = {
	allChats: Chat[];
	botReady: boolean;
	chatFilter: string;
	chats: Chat[];
	dateFrom: string;
	dateTo: string;
	deliveryFilter: DeliveryFilter;
	filter: SummaryFilter;
	firstMessageTimes?: Record<string, string | null>;
	loadSummaryDate: string;
	manualEditorOpen: boolean;
	page: number;
	query: string;
	searching: boolean;
	selectedChatId: string;
	selectedSummaryId: number | null;
	searchTerms: string[];
	summaries: Summary[];
	total: number;
	totalPages: number;
	onBatchRun: (chatIds: number[], dates: string[]) => Promise<void>;
	onChatFilterChange: (value: string) => void;
	onDateFromChange: (value: string) => void;
	onDateToChange: (value: string) => void;
	onDeliveryFilterChange: (value: DeliveryFilter) => void;
	onFilterChange: (value: SummaryFilter) => void;
	onLoadSummaryDateChange: (value: string) => void;
	onManualEditorToggle: () => void;
	onManualRun: () => Promise<void>;
	onPageChange: (value: number) => void;
	onQueryChange: (value: string) => void;
	onSelectedChatChange: (value: string) => void;
	onSelectSummary: (summaryId: number) => void;
	chatTitles: Map<number, string>;
};

export function SummaryListSection(props: SummaryListSectionProps) {
	const { language } = useI18n();
	const [filtersOpen, setFiltersOpen] = useState(false);
	const {
		allChats,
		botReady,
		chatFilter,
		chats,
		dateFrom,
		dateTo,
		deliveryFilter,
		filter,
		firstMessageTimes,
		loadSummaryDate,
		manualEditorOpen,
		page,
		query,
		searching,
		selectedChatId,
		selectedSummaryId,
		searchTerms,
		summaries,
		total,
		totalPages,
		onBatchRun,
		onChatFilterChange,
		onDateFromChange,
		onDateToChange,
		onDeliveryFilterChange,
		onFilterChange,
		onLoadSummaryDateChange,
		onManualEditorToggle,
		onManualRun,
		onPageChange,
		onQueryChange,
		onSelectedChatChange,
		onSelectSummary,
		chatTitles,
	} = props

	return (
		<Surface
			description="在这里搜索和筛选摘要记录；点开某条摘要后，会从右侧展开完整正文。"
			title="摘要记录"
		>
			{chats.length > 0 ? (
				<div className="chat-group-bar">
					<button
						className={`chat-group-pill${chatFilter === "all" ? " active" : ""}`}
						onClick={() => onChatFilterChange("all")}
						type="button"
					>
						全选（{chats.length} 个群组）
					</button>
					{chats.map((chat) => (
						<button
							key={chat.id}
							className={`chat-group-pill${chatFilter === String(chat.id) ? " active" : ""}`}
							onClick={() => onChatFilterChange(String(chat.id))}
							type="button"
						>
							{chat.title}
						</button>
					))}
				</div>
			) : null}

			<div className="summary-search-field">
				<Field label="搜索摘要关键词">
					<Input onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索摘要关键词" value={query} />
				</Field>
				<button
					aria-controls="summary-filters"
					aria-expanded={filtersOpen}
					className="summary-filter-toggle"
					onClick={() => setFiltersOpen((current) => !current)}
					type="button"
				>
					{filtersOpen ? "收起筛选" : "筛选"}
				</button>
			</div>

			<div className={`toolbar-grid summary-search-grid ${filtersOpen ? "mobile-open" : ""}`} id="summary-filters">
				<Field label="群组">
					<SearchSelect
						emptyText="没有匹配的群组"
						onChange={onChatFilterChange}
						options={[
							{ value: "all", label: "全部群组" },
							...allChats.map((chat) => ({
								value: String(chat.id),
								label: chat.title,
							})),
						]}
						placeholder="全部群组"
						searchPlaceholder="搜索群组"
						value={chatFilter}
					/>
				</Field>
				<Field label="生成状态">
					<AppSelect
						onChange={(value) => onFilterChange(value as SummaryFilter)}
						options={[
							{ value: "all", label: "全部状态" },
							{ value: "succeeded", label: "成功" },
							{ value: "processing", label: "处理中" },
							{ value: "running", label: "运行中" },
							{ value: "pending", label: "等待中" },
							{ value: "failed", label: "失败" },
						]}
						value={filter}
					/>
				</Field>
				<Field label="发送状态">
					<AppSelect
						onChange={(value) => onDeliveryFilterChange(value as DeliveryFilter)}
						options={[
							{ value: "all", label: "全部" },
							{ value: "sent", label: "已发送" },
							{ value: "pending", label: "待发送" },
							{ value: "failed", label: "发送失败" },
							{ value: "disabled", label: "不发送" },
						]}
						value={deliveryFilter}
					/>
				</Field>
				<Field label="开始日期">
					<Input onChange={(event) => onDateFromChange(event.target.value)} type="date" value={dateFrom} />
				</Field>
				<Field label="结束日期">
					<Input onChange={(event) => onDateToChange(event.target.value)} type="date" value={dateTo} />
				</Field>
			</div>

			<div className="summary-toolbar">
				<div className="summary-toolbar-meta">
					<span>{language === "en" ? `Page ${page} / ${totalPages}` : `第 ${page} / ${totalPages} 页`}</span>
					<span>{language === "en" ? `${total} summaries` : `共 ${total} 条摘要`}</span>
				</div>
				<Button className="summary-toolbar-button" onClick={onManualEditorToggle} type="button" variant="secondary">
					{manualEditorOpen ? "收起补跑" : "手动补跑"}
				</Button>
			</div>

			{manualEditorOpen ? (
				<ManualRunPanel
					chats={chats}
					firstMessageTimes={firstMessageTimes ?? {}}
					loadSummaryDate={loadSummaryDate}
					onBatchRun={onBatchRun}
					onLoadSummaryDateChange={onLoadSummaryDateChange}
					onManualRun={onManualRun}
					onSelectedChatChange={onSelectedChatChange}
					selectedChatId={selectedChatId}
				/>
			) : null}

			{summaries.length === 0 ? (
				<EmptyState
					description={searching ? "换个关键词或调整筛选条件后再试一次。" : "先展开手动补跑触发一次摘要，或者等待定时任务执行。"}
					title={searching ? "没有匹配的摘要" : "还没有摘要记录"}
				/>
			) : (
				<>
					<div className="entity-list">
						{summaries.map((item) => {
							const delivery = deliveryState(
								item,
								allChats.find((chat) => chat.id === item.chatId) ?? null,
								botReady,
							)
							const messageCountText = language === "en" ? `${item.sourceMessageCount} messages` : `消息 ${item.sourceMessageCount} 条`
							return (
								<button
									key={item.id}
									className={`entity-row ${item.id === selectedSummaryId ? "active" : ""}`}
									onClick={() => onSelectSummary(item.id)}
									type="button"
								>
									<div className="entity-row-main">
										<strong>{chatTitles.get(item.chatId) ?? "未知群组"}</strong>
										<p>
											{item.summaryDate} · {summaryModelLabel(item, language)} · {messageCountText}
										</p>
										{searching && item.matchSnippet ? (
											<p className="entity-row-snippet">
												<TextHighlight terms={searchTerms} text={item.matchSnippet} />
											</p>
										) : null}
									</div>
									<div className="entity-row-meta">
										<StatusPill tone={statusTone(item.status)}>{statusText(item.status)}</StatusPill>
										<StatusPill className={delivery.detail ? "status-pill-hoverable" : undefined} title={delivery.detail} tone={delivery.tone}>
											{delivery.label}
										</StatusPill>
									</div>
								</button>
							)
						})}
					</div>

					<div className="summary-pagination">
						<Button disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} type="button" variant="secondary">
							上一页
						</Button>
						<span>
							{language === "en" ? `Page ${page} of ${totalPages}` : `第 ${page} 页，共 ${totalPages} 页`}
						</span>
						<Button
							disabled={page >= totalPages}
							onClick={() => onPageChange(Math.min(totalPages, page + 1))}
							type="button"
							variant="secondary"
						>
							下一页
						</Button>
					</div>
				</>
			)}
		</Surface>
	)
}

function ManualRunPanel({
	chats,
	firstMessageTimes,
	loadSummaryDate,
	onBatchRun,
	onLoadSummaryDateChange,
	onManualRun,
	onSelectedChatChange,
	selectedChatId,
}: {
	chats: Chat[];
	firstMessageTimes: Record<string, string | null>;
	loadSummaryDate: string;
	onBatchRun: (chatIds: number[], dates: string[]) => Promise<void>;
	onLoadSummaryDateChange: (value: string) => void;
	onManualRun: () => Promise<void>;
	onSelectedChatChange: (value: string) => void;
	selectedChatId: string;
}) {
	const [batchMode, setBatchMode] = useState(false);
	const [batchChatIds, setBatchChatIds] = useState<Set<number>>(new Set());
	const [batchDateFrom, setBatchDateFrom] = useState(localDateOffset(-6));
	const [batchDateTo, setBatchDateTo] = useState(localDateInputValue());

	// 所选群组最早一条消息日期，作为日期选择器的最小下界
	const batchMinDate = useMemo(() => {
		if (batchChatIds.size === 0) return undefined;
		const dates = Array.from(batchChatIds)
			.map((id) => firstMessageTimes[String(id)])
			.filter((d): d is string => Boolean(d))
			.map((iso) => iso.slice(0, 10));
		if (dates.length === 0) return undefined;
		return dates.reduce((a, b) => (a < b ? a : b));
	}, [batchChatIds, firstMessageTimes]);

	const allSelected = chats.length > 0 && batchChatIds.size === chats.length;

	function toggleChat(id: number) {
		setBatchChatIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleAll() {
		if (allSelected) {
			setBatchChatIds(new Set());
		} else {
			setBatchChatIds(new Set(chats.map((c) => c.id)));
		}
	}

	function datesInRange(from: string, to: string): string[] {
		const dates: string[] = [];
		const start = new Date(from);
		const end = new Date(to);
		for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
			dates.push(d.toISOString().slice(0, 10));
		}
		return dates;
	}

	const batchDates = datesInRange(batchDateFrom, batchDateTo);
	const batchTotal = batchChatIds.size * batchDates.length;

	if (chats.length === 0) {
		return (
			<div className="summary-manual-panel">
				<EmptyState description="只有已启用 AI 总结的群组才会出现在这里。" title="还没有可补跑的群组" />
			</div>
		);
	}

	return (
		<div className="summary-manual-panel">
			<div className="summary-manual-head">
				<strong>手动补跑</strong>
				<p>只会显示已启用 AI 总结的群组。</p>
			</div>
			<div className="summary-manual-mode">
				<button
					className={`summary-mode-tab${!batchMode ? " active" : ""}`}
					onClick={() => setBatchMode(false)}
					type="button"
				>
					单次
				</button>
				<button
					className={`summary-mode-tab${batchMode ? " active" : ""}`}
					onClick={() => setBatchMode(true)}
					type="button"
				>
					批量
				</button>
			</div>

			{!batchMode ? (
				<>
					<div className="batch-chat-list">
						{chats.map((chat) => (
							<button
								key={chat.id}
								className={`batch-chat-item${selectedChatId === String(chat.id) ? " selected" : ""}`}
								onClick={() => onSelectedChatChange(String(chat.id))}
								type="button"
							>
								{chat.title}
							</button>
						))}
					</div>
					<div className="form-grid">
						<Field label="日期">
							<Input
								onChange={(event) => onLoadSummaryDateChange(event.target.value)}
								type="date"
								value={loadSummaryDate}
							/>
						</Field>
					</div>
					<div className="summary-manual-actions">
						<Button
							disabled={!selectedChatId}
							onClick={() => startTransition(() => void onManualRun())}
							type="button"
						>
							立即生成
						</Button>
					</div>
				</>
			) : (
				<>
					<div className="batch-chat-list">
						<button className={`batch-chat-item${allSelected ? " selected" : ""}`} onClick={toggleAll} type="button">
							全选（{chats.length} 个群组）
						</button>
						{chats.map((chat) => (
							<button
								key={chat.id}
								className={`batch-chat-item${batchChatIds.has(chat.id) ? " selected" : ""}`}
								onClick={() => toggleChat(chat.id)}
								type="button"
							>
								{chat.title}
							</button>
						))}
					</div>
					<div className="form-grid">
						<Field label="起始日期" hint={batchMinDate ? `最早可选：${batchMinDate}` : undefined}>
							<Input
								min={batchMinDate}
								max={localDateInputValue()}
								onChange={(e) => setBatchDateFrom(e.target.value)}
								type="date"
								value={batchDateFrom}
							/>
						</Field>
						<Field label="结束日期">
							<Input
								min={batchMinDate}
								max={localDateInputValue()}
								onChange={(e) => setBatchDateTo(e.target.value)}
								type="date"
								value={batchDateTo}
							/>
						</Field>
					</div>
					{batchMinDate && batchDateFrom < batchMinDate ? (
						<p className="batch-summary-hint warn">
							⚠️ 起始日期早于 {batchMinDate}（所选群组最早消息日期），该日期之前不会有消息可用
						</p>
					) : null}
					{batchTotal > 0 ? (
						<p className="batch-summary-hint">
							将提交 {batchChatIds.size} 个群组 × {batchDates.length} 天 = {batchTotal} 个任务
						</p>
					) : null}
					<div className="summary-manual-actions">
						<Button
							disabled={batchChatIds.size === 0 || batchDates.length === 0}
							onClick={() =>
								startTransition(() =>
									void onBatchRun(Array.from(batchChatIds), batchDates)
								)
							}
							type="button"
						>
							批量生成
						</Button>
					</div>
				</>
			)}
		</div>
	);
}

export function localDateOffset(offsetDays: number) {
	const now = new Date();
	now.setDate(now.getDate() + offsetDays);
	const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 10);
}

export function statusTone(status: Summary["status"]) {
	if (status === "succeeded") return "good"
	if (status === "failed") return "bad"
	if (status === "running") return "warn"
	return "neutral"
}

export function statusText(status: Summary["status"]) {
	if (status === "succeeded") return "成功"
	if (status === "failed") return "失败"
	if (status === "running") return "运行中"
	return "等待中"
}

export function deliveryState(
	summary: Summary,
	chat: Chat | null,
	botReady: boolean,
): DeliveryState {
	if (!chat || chat.deliveryMode !== "bot") {
		return { label: "不发送", tone: "neutral", detail: "当前群组设置为不通过 Bot 推送。", retryable: false }
	}
	if (summary.dailyDigestId) {
		if (!summary.dailyDigestIncluded && summary.dailyDigestOmissionReason === "empty_content") {
			return { label: "未纳入总览", tone: "neutral", detail: "总览创建时该群摘要正文为空，请先重新生成单群摘要。", retryable: false }
		}
		if (!summary.dailyDigestIncluded && summary.dailyDigestOmissionReason === "no_messages") {
			return { label: "当日无消息", tone: "neutral", detail: "该群当天没有新消息，已完成等待但未进入总览正文。", retryable: false }
		}
		if (!summary.dailyDigestIncluded) {
			return { label: "未纳入总览", tone: "neutral", detail: "单群摘要生成失败，无法纳入每日总览。", retryable: false }
		}
		if (summary.dailyDigestStatus === "failed") {
			return { label: "总览生成失败", tone: "bad", detail: "该摘要已纳入每日总览，但总览生成失败。", retryable: false }
		}
		if (summary.dailyDigestStatus === "pending" || summary.dailyDigestStatus === "running") {
			return { label: "等待总览", tone: "warn", detail: "每日总览正在处理该摘要。", retryable: false }
		}
		if (summary.dailyDigestDeliveredAt || summary.dailyDigestDeliverySkippedReason) {
			return { label: "已归入总览", tone: "good", detail: "该摘要已由每日总览统一处理。", retryable: false }
		}
		if (summary.dailyDigestDeliveryError) {
			return { label: "总览发送失败", tone: "bad", detail: summary.dailyDigestDeliveryError, retryable: false }
		}
		if (summary.dailyDigestDeliverySuppressed) {
			return { label: "总览待手动发送", tone: "warn", detail: "每日总览已由用户重新生成，需要手动确认发送。", retryable: false }
		}
		return { label: "总览待发送", tone: "warn", detail: "每日总览已经生成，等待统一发送。", retryable: false }
	}
	if (summary.deliveredAt) {
		return { label: "已发送", tone: "good", detail: `已发送于 ${summary.deliveredAt}`, retryable: false }
	}
	if (summary.dailyDigestStatus) {
		return { label: "未纳入当日总览", tone: "neutral", detail: "当日总览已创建，但未包含该群。可按最新群组配置重新生成并发送。", retryable: false }
	}
	if (summary.botSummaryDeliveryMode === "daily_digest") {
		if (summary.status === "failed") {
			return { label: "未纳入总览", tone: "neutral", detail: "单群摘要生成失败，无法纳入每日总览。", retryable: false }
		}
		return {
			label: "等待总览",
			tone: botReady ? "warn" : "neutral",
			detail: botReady ? "等待其它参与群组完成后统一生成每日总览。" : "Bot 配置尚未完成，暂时无法生成每日总览。",
			retryable: false,
		}
	}
	if (!botReady) {
		return { label: "待发送", tone: "warn", detail: "Bot 配置尚未完成，当前无法发送。", retryable: false }
	}
	if (summary.status !== "succeeded") {
		return { label: "未发送", tone: "neutral", detail: "摘要尚未生成成功，当前不会执行发送。", retryable: false }
	}
	if (summary.deliveryError && summary.nextDeliveryRetryAt) {
		return { label: "等待自动重试", tone: "warn", detail: summary.deliveryError, retryable: true }
	}
	if (summary.deliveryError) {
		return { label: "发送失败", tone: "bad", detail: summary.deliveryError, retryable: true }
	}
	return { label: "待发送", tone: "warn", detail: "摘要已生成，等待自动发送或手动重试。", retryable: true }
}

export function localDateInputValue() {
	const now = new Date()
	const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
	return local.toISOString().slice(0, 10)
}
