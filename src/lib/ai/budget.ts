import "server-only";
import { sql } from "../db";
import { env } from "../env";

/**
 * Monthly spend guard.
 *
 * Every OpenAI call is recorded in `ai_usage`. Before a call runs we sum the
 * current calendar month and refuse if it is already over the ceiling. A
 * runaway loop is the realistic way a personal project produces a surprise
 * bill, so the check is a hard stop rather than a warning.
 */

export class BudgetExceededError extends Error {
  readonly spent: number;
  readonly limit: number;

  constructor(spent: number, limit: number) {
    super(
      `OpenAI budget exhausted: $${spent.toFixed(2)} spent of $${limit.toFixed(2)} this month. ` +
        `Raise OPENAI_MONTHLY_BUDGET_USD or wait for the month to roll over.`,
    );
    this.name = "BudgetExceededError";
    this.spent = spent;
    this.limit = limit;
  }
}

export interface BudgetStatus {
  spent: number;
  limit: number;
  remaining: number;
  /** True when the guard is switched off (limit of 0). */
  unlimited: boolean;
  callCount: number;
}

/** Spend so far this calendar month. */
export async function monthToDateSpend(): Promise<number> {
  const rows = await sql<{ total: string | null }[]>`
    select sum(cost_usd)::text as total
    from ai_usage
    where at >= date_trunc('month', now())
      and ok
  `;
  return Number(rows[0]?.total ?? 0);
}

export async function budgetStatus(): Promise<BudgetStatus> {
  const limit = env.monthlyBudgetUsd;
  const rows = await sql<{ total: string | null; calls: string }[]>`
    select sum(cost_usd)::text as total, count(*)::text as calls
    from ai_usage
    where at >= date_trunc('month', now())
      and ok
  `;
  const spent = Number(rows[0]?.total ?? 0);
  return {
    spent,
    limit,
    remaining: limit === 0 ? Infinity : Math.max(0, limit - spent),
    unlimited: limit === 0,
    callCount: Number(rows[0]?.calls ?? 0),
  };
}

/** Throw if the month's spend already exceeds the configured ceiling. */
export async function assertWithinBudget(): Promise<void> {
  const limit = env.monthlyBudgetUsd;
  if (limit === 0) return;

  const spent = await monthToDateSpend();
  if (spent >= limit) throw new BudgetExceededError(spent, limit);
}

export interface UsageRecord {
  purpose: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  costUsd: number;
  jobId?: number | null;
  ok?: boolean;
  error?: string | null;
}

/** Append one call to the usage ledger. Never throws — logging must not break work. */
export async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    await sql`
      insert into ai_usage (
        purpose, model, prompt_tokens, completion_tokens, cached_tokens,
        cost_usd, job_id, ok, error
      ) values (
        ${record.purpose}, ${record.model}, ${record.promptTokens},
        ${record.completionTokens}, ${record.cachedTokens ?? 0},
        ${record.costUsd}, ${record.jobId ?? null}, ${record.ok ?? true},
        ${record.error ?? null}
      )
    `;
  } catch (error) {
    console.error("Failed to record AI usage", error);
  }
}
