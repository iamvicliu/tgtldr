package model

import "time"

// SummaryFrequency 决定单群摘要覆盖的时间范围：按天、按周（周一至周日）或按月。
type SummaryFrequency string

const (
	SummaryFrequencyDaily   SummaryFrequency = "daily"
	SummaryFrequencyWeekly  SummaryFrequency = "weekly"
	SummaryFrequencyMonthly SummaryFrequency = "monthly"
)

// NormalizeSummaryFrequency 把未知或空值归一为按天。
func NormalizeSummaryFrequency(value SummaryFrequency) SummaryFrequency {
	switch value {
	case SummaryFrequencyWeekly, SummaryFrequencyMonthly:
		return value
	default:
		return SummaryFrequencyDaily
	}
}

// SummaryPeriodEndDate 返回以 startDate 为起点的摘要周期最后一天（含）。
func SummaryPeriodEndDate(startDate string, frequency SummaryFrequency) string {
	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return startDate
	}
	switch NormalizeSummaryFrequency(frequency) {
	case SummaryFrequencyWeekly:
		return start.AddDate(0, 0, 6).Format("2006-01-02")
	case SummaryFrequencyMonthly:
		return start.AddDate(0, 1, -1).Format("2006-01-02")
	default:
		return startDate
	}
}
