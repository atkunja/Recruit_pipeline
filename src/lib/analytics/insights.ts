import type { Breakdown, FunnelMetrics } from "./metrics";

/**
 * Insight generation.
 *
 * The hard rule here is that a conclusion only appears when the data can
 * support it. Telling someone "applying within 48 hours triples your OA rate"
 * off the back of three applications is worse than saying nothing — they will
 * change their behaviour based on noise.
 *
 * So every rule below requires a minimum sample in *each* group being compared
 * and a difference large enough not to be a coin flip. Pure and deterministic:
 * no model call, nothing to hallucinate.
 */

export interface Insight {
  headline: string;
  detail: string;
  confidence: "emerging" | "solid";
}

/** Each compared group needs at least this many applications. */
const MIN_PER_GROUP = 8;
/** Below this many, the finding is labelled emerging rather than solid. */
const SOLID_PER_GROUP = 20;
/** Percentage-point gap worth mentioning. */
const MIN_GAP = 15;

export function buildInsights(input: {
  metrics: FunnelMetrics;
  byScoreBand: Breakdown[];
  byOutreach: Breakdown[];
  bySpeed: Breakdown[];
  byCategory: Breakdown[];
}): Insight[] {
  const insights: Insight[] = [];

  insights.push(...compareTwo(input.byOutreach, "with outreach", "no outreach", (better, worse, gap, confidence) => ({
    headline:
      better.label === "with outreach"
        ? "Reaching out is working"
        : "Outreach isn't moving the needle yet",
    detail:
      better.label === "with outreach"
        ? `Applications where you emailed someone reach an OA ${gap} points more often (${better.oaRate}% of ${better.applications} vs ${worse.oaRate}% of ${worse.applications}).`
        : `Applications without outreach are doing better so far (${better.oaRate}% of ${better.applications} vs ${worse.oaRate}% of ${worse.applications}). Worth checking who you're emailing and what you're saying.`,
    confidence,
  })));

  insights.push(...compareTwo(input.bySpeed, "within 48h", "over a week", (better, worse, gap, confidence) => ({
    headline:
      better.label === "within 48h"
        ? "Applying early pays off"
        : "Speed isn't the deciding factor",
    detail:
      better.label === "within 48h"
        ? `Applications submitted within 48 hours of discovery reach an OA ${gap} points more often (${better.oaRate}% of ${better.applications} vs ${worse.oaRate}% of ${worse.applications} sent after a week).`
        : `Applying fast hasn't helped so far — ${better.oaRate}% for ${better.label} vs ${worse.oaRate}% for ${worse.label}. Prioritise fit over speed.`,
    confidence,
  })));

  // Score bands: does the scorer actually predict outcomes?
  const high = input.byScoreBand.find((row) => row.label === "90-100");
  const mid = input.byScoreBand.find(
    (row) => row.label === "70-79" || row.label === "under 70",
  );
  if (
    high !== undefined &&
    mid !== undefined &&
    high.applications >= MIN_PER_GROUP &&
    mid.applications >= MIN_PER_GROUP &&
    high.oaRate !== null &&
    mid.oaRate !== null
  ) {
    const gap = high.oaRate - mid.oaRate;
    if (Math.abs(gap) >= MIN_GAP) {
      insights.push({
        headline:
          gap > 0
            ? "Your fit scores are predictive"
            : "Your fit scores are not predicting outcomes",
        detail:
          gap > 0
            ? `90+ jobs reach an OA ${gap} points more often than sub-80 jobs (${high.oaRate}% vs ${mid.oaRate}%). Keep the Discover floor high.`
            : `Lower-scored jobs are converting better than 90+ ones (${mid.oaRate}% vs ${high.oaRate}%). Worth retuning the scoring weights in Settings.`,
        confidence:
          Math.min(high.applications, mid.applications) >= SOLID_PER_GROUP
            ? "solid"
            : "emerging",
      });
    }
  }

  // The strongest company category, once there is enough to compare.
  const eligible = input.byCategory.filter(
    (row) => row.applications >= MIN_PER_GROUP && row.oaRate !== null,
  );
  if (eligible.length >= 2) {
    const sorted = [...eligible].sort((a, b) => (b.oaRate ?? 0) - (a.oaRate ?? 0));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (
      best !== undefined &&
      worst !== undefined &&
      best.oaRate !== null &&
      worst.oaRate !== null &&
      best.oaRate - worst.oaRate >= MIN_GAP
    ) {
      insights.push({
        headline: `${label(best.label)} companies respond most`,
        detail: `${best.oaRate}% of your ${best.applications} ${label(best.label)} applications reach an OA, against ${worst.oaRate}% for ${label(worst.label)}. Consider weighting discovery toward them.`,
        confidence:
          best.applications >= SOLID_PER_GROUP ? "solid" : "emerging",
      });
    }
  }

  // A funnel-level observation that needs no comparison group.
  const { metrics } = input;
  if (
    metrics.applicationsSubmitted >= 15 &&
    metrics.oaRate !== null &&
    metrics.oaRate < 10
  ) {
    insights.push({
      headline: "Low OA rate across the board",
      detail: `${metrics.oaReceived} assessments from ${metrics.applicationsSubmitted} applications (${metrics.oaRate}%). At this volume that usually points at the resume or at targeting, not at luck.`,
      confidence: metrics.applicationsSubmitted >= 40 ? "solid" : "emerging",
    });
  }

  if (
    metrics.outreachSent >= 10 &&
    metrics.responseRate !== null &&
    metrics.responseRate >= 25
  ) {
    insights.push({
      headline: "Your outreach gets replies",
      detail: `${metrics.repliesReceived} of ${metrics.outreachSent} emails got a response (${metrics.responseRate}%). That is well above typical cold-email rates — send more of them.`,
      confidence: metrics.outreachSent >= 30 ? "solid" : "emerging",
    });
  }

  return insights;
}

/** Compare two named groups from a breakdown, when both are big enough. */
function compareTwo(
  rows: Breakdown[],
  labelA: string,
  labelB: string,
  build: (
    better: Breakdown,
    worse: Breakdown,
    gap: number,
    confidence: "emerging" | "solid",
  ) => Insight,
): Insight[] {
  const a = rows.find((row) => row.label === labelA);
  const b = rows.find((row) => row.label === labelB);

  if (a === undefined || b === undefined) return [];
  if (a.applications < MIN_PER_GROUP || b.applications < MIN_PER_GROUP) return [];
  if (a.oaRate === null || b.oaRate === null) return [];

  const gap = Math.abs(a.oaRate - b.oaRate);
  if (gap < MIN_GAP) return [];

  const [better, worse] = a.oaRate >= b.oaRate ? [a, b] : [b, a];
  const confidence =
    Math.min(a.applications, b.applications) >= SOLID_PER_GROUP
      ? "solid"
      : "emerging";

  return [build(better, worse, gap, confidence)];
}

function label(value: string): string {
  return value.replace(/_/g, " ");
}

/** How much more data is needed before insights appear. */
export function dataGap(metrics: FunnelMetrics): string | null {
  if (metrics.applicationsSubmitted >= MIN_PER_GROUP * 2) return null;
  const needed = MIN_PER_GROUP * 2 - metrics.applicationsSubmitted;
  return `${needed} more application${needed === 1 ? "" : "s"} before there's enough data to draw conclusions.`;
}
