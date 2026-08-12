import { ashbyAdapter } from "./ashby";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import { simplifyAdapter } from "./simplify";
import type { SourceAdapter } from "./types";
import type { SourceKind } from "../types";

/**
 * Adapter registry.
 *
 * Registering a new board is one line here plus one `job_sources` row.
 *
 * Deliberately absent: jobright.ai. Its recommendation feed sits behind a
 * personal login and is a paid product, so pulling it would mean driving the
 * user's authenticated session against that site's terms. Postings found there
 * can still be brought in through the manual "Add a job" form.
 */
const ADAPTERS: Partial<Record<SourceKind, SourceAdapter>> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  simplify: simplifyAdapter,
};

export function getAdapter(kind: SourceKind): SourceAdapter | null {
  return ADAPTERS[kind] ?? null;
}

export function listAdapters(): SourceAdapter[] {
  return Object.values(ADAPTERS).filter(
    (adapter): adapter is SourceAdapter => adapter !== undefined,
  );
}

/**
 * Titles worth pulling into the database at all.
 *
 * A first, extremely cheap pass applied inside adapters so a 4,000-posting
 * board doesn't turn into 4,000 objects in memory. It is intentionally looser
 * than the real prefilter — anything plausibly technical and internship-shaped
 * gets through, and `prefilter.ts` makes the actual decision.
 */
const INTERESTING =
  /\b(intern|internship|co-?op|new ?grad|university|student|apprentice|summer)\b/i;

const TECHNICAL =
  /\b(software|swe|engineer|engineering|developer|backend|back-?end|frontend|front-?end|full-?stack|infrastructure|infra|platform|cloud|systems|distributed|data|machine learning|ml|ai|research|security|network|compiler|embedded|robotics|autonomy|perception|quant|quantitative|technology|technical|computer)\b/i;

export function isTitleInteresting(title: string): boolean {
  return INTERESTING.test(title) && TECHNICAL.test(title);
}
