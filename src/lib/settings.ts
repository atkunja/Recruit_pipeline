import "server-only";
import { json, sql } from "./db";
import { DEFAULT_WEIGHTS, parseWeights, type ScoringWeights } from "./scoring/weights";

/** Typed accessors over the `settings` key/value table. */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await sql<{ value: unknown }[]>`
    select value from settings where key = ${key}
  `;
  const row = rows[0];
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await sql`
    insert into settings (key, value, updated_at)
    values (${key}, ${sql.json(json(value))}, now())
    on conflict (key) do update
      set value = excluded.value, updated_at = now()
  `;
}

export async function getScoringWeights(): Promise<ScoringWeights> {
  const raw = await getSetting<unknown>("scoring_weights", DEFAULT_WEIGHTS);
  return parseWeights(raw);
}

export async function setScoringWeights(weights: ScoringWeights): Promise<void> {
  await setSetting("scoring_weights", weights);
}

/**
 * When jobs get scored.
 *
 *   auto      — every discovery run scores what it finds (costs money on a schedule)
 *   on_demand — nothing is scored until you ask for it on a job (the default)
 *   off       — scoring is disabled entirely
 *
 * Defaults to on_demand: Discover sorts by newest and shows everything found,
 * so a score is useful when comparing a shortlist, not for every posting that
 * arrives.
 */
export type ScoringMode = "auto" | "on_demand" | "off";

export async function getScoringMode(): Promise<ScoringMode> {
  const value = await getSetting<string>("scoring_mode", "on_demand");
  return value === "auto" || value === "off" ? value : "on_demand";
}

export async function setScoringMode(mode: ScoringMode): Promise<void> {
  await setSetting("scoring_mode", mode);
}

/** Feature flags. Both default to false and must be turned on deliberately. */
export async function isAutoSubmitEnabled(): Promise<boolean> {
  return getSetting<boolean>("auto_submit_enabled", false);
}

export async function isAutoSendEnabled(): Promise<boolean> {
  return getSetting<boolean>("auto_send_enabled", false);
}

/**
 * Saved answers to self-identification questions, keyed by a normalized form
 * of the question. Absent by default: nothing demographic is answered unless
 * the user has explicitly stored a preference.
 */
export async function getSensitiveAnswers(): Promise<Record<string, string>> {
  return getSetting<Record<string, string>>("sensitive_answers", {});
}
