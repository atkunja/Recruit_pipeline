/**
 * Compensation extraction.
 *
 * Nothing here scrapes a new source. Pay-transparency laws in California,
 * Colorado, New York, Washington and Illinois mean most postings state a range
 * inline, and the ATS APIs already return a structured field for some. This
 * reads what is already in the description we fetched.
 *
 * Intern pay is quoted in wildly different units — $45/hr, $7,600 weekly,
 * $10,000/month, $80,000 annually — so everything is normalized to a monthly
 * figure for comparison, while the original wording is kept for display.
 *
 * Pure and dependency-free, so it can be tested exhaustively.
 */

export type PayPeriod = "hour" | "week" | "month" | "year";

export interface Compensation {
  /** Lower bound in the stated period's units. */
  min: number;
  /** Upper bound. Equals `min` for a single figure. */
  max: number;
  period: PayPeriod;
  currency: string;
  /** Normalized to a monthly figure so different units can be ranked together. */
  monthlyMin: number;
  monthlyMax: number;
  /** The matched text, for display and for auditing a bad parse. */
  raw: string;
  /** False when the period had to be inferred from magnitude. */
  periodStated: boolean;
}

/** Conversion to a monthly equivalent. Hourly assumes a 40-hour week. */
const TO_MONTHLY: Record<PayPeriod, number> = {
  hour: (40 * 52) / 12,
  week: 52 / 12,
  month: 1,
  year: 1 / 12,
};

const PERIOD_WORDS: [RegExp, PayPeriod][] = [
  [/\b(per\s+hour|an?\s+hour|hourly|\/\s*hour|\/\s*hr|p\/h)\b/i, "hour"],
  [/\b(per\s+week|a\s+week|weekly|\/\s*week|\/\s*wk)\b/i, "week"],
  [/\b(per\s+month|a\s+month|monthly|\/\s*month|\/\s*mo)\b/i, "month"],
  [/\b(per\s+year|a\s+year|annually|annual|yearly|\/\s*year|\/\s*yr|per\s+annum)\b/i, "year"],
];

/**
 * Phrases that mean the number nearby is NOT pay.
 * Trading firms describe themselves as "$17 billion multi-strategy", and
 * job posts mention funding rounds and revenue — none of which is your salary.
 */
const NOT_PAY = [
  /\b(billion|trillion)\b/i,
  /\b(assets? under management|aum|raised|valuation|revenue|funding|series [a-f]\b|market cap)\b/i,
  /\b(fund|portfolio) (of|size)\b/i,
];

/** Money with optional range, e.g. "$45.00 - $65.00" or "$80,000 — $88,000". */
const MONEY =
  /(?<cur>USD|\$)\s*(?<a>\d[\d,]*(?:\.\d{1,2})?)\s*(?:(?:-|–|—|to|through|and)\s*\$?\s*(?<b>\d[\d,]*(?:\.\d{1,2})?))?/gi;

function toNumber(value: string): number {
  return Number(value.replace(/,/g, ""));
}

/**
 * Infer a period from magnitude when the text doesn't say.
 * Deliberately conservative — the bands are wide enough that a genuinely
 * ambiguous figure lands in the right one.
 */
function inferPeriod(amount: number): PayPeriod {
  if (amount <= 300) return "hour";
  if (amount <= 30_000) return "month";
  return "year";
}

/**
 * Extract the most plausible pay figure from a block of text.
 *
 * Returns the *highest* normalized match, because postings often mention a
 * small number first (a relocation stipend, a referral bonus) before the
 * actual salary band.
 */
export function parseCompensation(
  text: string | null | undefined,
): Compensation | null {
  if (!text) return null;

  const candidates: Compensation[] = [];

  for (const match of text.matchAll(MONEY)) {
    const groups = match.groups;
    if (!groups?.a) continue;

    const end = match.index + match[0].length;

    // Disqualifiers are checked against a wide window — "$17 billion" and the
    // words "assets under management" can be a clause apart.
    const wide = text.slice(Math.max(0, match.index - 90), end + 90);
    if (NOT_PAY.some((pattern) => pattern.test(wide))) continue;

    // The period is checked against a NARROW window, and after the figure
    // first. A wide window let "per hour" from the following sentence attach
    // itself to an unrelated "$2,000 relocation stipend", which then
    // normalised to $346k/month and outranked the actual salary.
    const after = text.slice(end, end + 30);
    const before = text.slice(Math.max(0, match.index - 40), match.index);

    const min = toNumber(groups.a);
    const max = groups.b === undefined ? min : toNumber(groups.b);
    if (!Number.isFinite(min) || min <= 0) continue;
    // A bare "$5" is a coffee, not a salary; a billion is the firm's AUM.
    if (min < 10 || min > 5_000_000) continue;
    if (max < min) continue;

    let period: PayPeriod | null = null;
    for (const [pattern, value] of PERIOD_WORDS) {
      if (pattern.test(after)) {
        period = value;
        break;
      }
    }
    if (period === null) {
      // "hourly rate of $45" / "annual salary of $120,000"
      for (const [pattern, value] of PERIOD_WORDS) {
        if (pattern.test(before)) {
          period = value;
          break;
        }
      }
    }

    const periodStated = period !== null;
    const resolved = period ?? inferPeriod(min);

    candidates.push({
      min,
      max,
      period: resolved,
      currency: groups.cur?.toUpperCase() === "USD" ? "USD" : "USD",
      monthlyMin: Math.round(min * TO_MONTHLY[resolved]),
      monthlyMax: Math.round(max * TO_MONTHLY[resolved]),
      raw: match[0].replace(/\s+/g, " ").trim(),
      periodStated,
    });
  }

  if (candidates.length === 0) return null;

  // Prefer an explicitly-periodised figure, then the largest.
  candidates.sort((a, b) => {
    if (a.periodStated !== b.periodStated) return a.periodStated ? -1 : 1;
    return b.monthlyMax - a.monthlyMax;
  });

  return candidates[0] ?? null;
}

/** Human-readable form for the UI, e.g. "$45–65/hr" or "$10,000/mo". */
export function formatCompensation(comp: Compensation): string {
  const unit =
    comp.period === "hour"
      ? "/hr"
      : comp.period === "week"
        ? "/wk"
        : comp.period === "month"
          ? "/mo"
          : "/yr";

  const format = (value: number): string =>
    comp.period === "hour"
      ? `$${value % 1 === 0 ? value : value.toFixed(2)}`
      : `$${Math.round(value).toLocaleString("en-US")}`;

  const range =
    comp.min === comp.max
      ? format(comp.min)
      : `${format(comp.min)}–${format(comp.max).replace("$", "")}`;

  return `${range}${unit}`;
}

/** Roughly what a figure is worth per month, for sorting across units. */
export function monthlyMidpoint(comp: Compensation): number {
  return Math.round((comp.monthlyMin + comp.monthlyMax) / 2);
}
