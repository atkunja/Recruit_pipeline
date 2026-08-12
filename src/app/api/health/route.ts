import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isGmailConfigured, isOpenAiConfigured } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health check.
 *
 * Reports whether the pieces this app needs are actually reachable, not just
 * configured. Returns 503 when the database is down so an uptime monitor can
 * alert on it; everything else is informational, because Gmail and OpenAI being
 * absent degrades features rather than breaking the app.
 *
 * Sits behind the session gate like everything else — it exposes counts and
 * configuration state, which is not something to publish anonymously.
 */
export async function GET(): Promise<Response> {
  const startedAt = Date.now();

  let database: { ok: boolean; latencyMs: number; error?: string };
  let counts: Record<string, number> | null = null;

  try {
    const t = Date.now();
    const rows = await sql<
      {
        jobs: number;
        scored: number;
        sources: number;
        failingSources: number;
        applications: number;
        pendingDrafts: number;
      }[]
    >`
      select
        (select count(*)::int from jobs where is_active and canonical_job_id is null) as jobs,
        (select count(*)::int from job_scores) as scored,
        (select count(*)::int from job_sources where enabled) as sources,
        (select count(*)::int from job_sources where consecutive_failures >= 3) as "failingSources",
        (select count(*)::int from applications) as applications,
        (select count(*)::int from outreach_messages where status in ('draft','approved')) as "pendingDrafts"
    `;
    database = { ok: true, latencyMs: Date.now() - t };
    counts = rows[0] ?? null;
  } catch (error) {
    database = {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message.split("\n")[0] : "unknown",
    };
  }

  const body = {
    status: database.ok ? "ok" : "degraded",
    checkedAt: new Date().toISOString(),
    totalMs: Date.now() - startedAt,
    database,
    integrations: {
      openai: isOpenAiConfigured(),
      gmail: isGmailConfigured(),
    },
    counts,
  };

  return NextResponse.json(body, { status: database.ok ? 200 : 503 });
}
