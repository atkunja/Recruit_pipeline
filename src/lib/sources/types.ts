import type { CompanyCategory, SourceKind } from "../types";

/**
 * Source adapter contract.
 *
 * Adding a job board is: write one of these, register it in `registry.ts`,
 * insert a `job_sources` row. Nothing else in the system changes.
 */

/** A posting as the board reports it, before normalization. */
export interface RawPosting {
  companyName: string;
  title: string;
  url: string;

  sourceJobId?: string | null;
  locationRaw?: string | null;
  description?: string | null;
  compensation?: string | null;
  postedAt?: Date | null;
  companyWebsite?: string | null;
  companyCategory?: CompanyCategory;

  /** Original payload, kept for debugging a bad parse. */
  raw?: unknown;
}

export interface AdapterContext {
  /**
   * Titles worth fetching a full description for. Adapters that need a second
   * request per posting use this to avoid fetching hundreds of irrelevant ones.
   */
  isTitleInteresting: (title: string) => boolean;
  /** Abort signal so a slow board can't hold up a whole cron run. */
  signal: AbortSignal;
}

export interface SourceAdapter {
  kind: SourceKind;
  /** Human label used in the Sources UI. */
  label: string;
  /**
   * Fetch every posting this source currently lists.
   * Throwing is fine — the runner records the failure against the source row.
   */
  fetch(
    config: Record<string, unknown>,
    context: AdapterContext,
  ): Promise<RawPosting[]>;
}

/** Shared fetch helper: JSON, timeout, and a real user agent. */
export async function getJson<T>(
  url: string,
  signal: AbortSignal,
  timeoutMs = 20_000,
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent":
        "recruiting-pipeline/1.0 (personal job search tool; +https://github.com/atkunja/Recruit_pipeline)",
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Shared fetch helper for text endpoints (raw markdown, HTML). */
export async function getText(
  url: string,
  signal: AbortSignal,
  timeoutMs = 20_000,
): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "recruiting-pipeline/1.0 (personal job search tool; +https://github.com/atkunja/Recruit_pipeline)",
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.text();
}

/** Read a required string from an adapter's config blob. */
export function configString(
  config: Record<string, unknown>,
  key: string,
): string {
  const value = config[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Source config is missing "${key}"`);
  }
  return value;
}
