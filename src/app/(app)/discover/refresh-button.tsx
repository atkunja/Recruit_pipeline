"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RunResult {
  sourcesRun: number;
  jobsNew: number;
  jobsDuplicate: number;
  enriched: number;
  scored: number;
  scoringSkipped?: string;
  errors?: { source: string; error: string }[];
}

/**
 * Pull new jobs, from the page where you'd look for them.
 *
 * Nothing runs on a schedule when the app is on your own machine — Vercel Cron
 * and the GitHub Actions workflow only fire against a deployment. Reloading
 * Discover re-queries the database but does not go and fetch anything, so
 * without this the only way to get new jobs locally was buried in Settings.
 */
export function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/sources/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Sources rotate by least-recently-polled, so a short run still makes
        // progress across all of them over successive presses.
        body: JSON.stringify({
          maxSources: 500,
          maxEnrichments: 60,
          maxScored: 40,
          timeBudgetMs: 60_000,
        }),
      });

      if (!response.ok) {
        const data: unknown = await response.json().catch(() => null);
        setError(
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : `Failed (${response.status})`,
        );
        return;
      }

      setResult((await response.json()) as RunResult);
      router.refresh();
    } catch {
      setError("The request timed out. The server may still be working — reload the page.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Checking boards…" : "Find new jobs"}
      </button>

      {busy && (
        <span className="text-[11px] text-faint">
          Polling job boards. This takes up to a minute.
        </span>
      )}

      {result !== null && !busy && (
        <span className="text-[11px] text-faint">
          {result.jobsNew > 0 ? (
            <span className="text-success">{result.jobsNew} new</span>
          ) : (
            "nothing new"
          )}
          {" · "}
          {result.sourcesRun} boards checked
          {result.jobsDuplicate > 0 && ` · ${result.jobsDuplicate} already known`}
          {result.errors !== undefined && result.errors.length > 0 &&
            ` · ${result.errors.length} failed`}
        </span>
      )}

      {error !== null && (
        <span className="max-w-xs text-right text-[11px] text-danger">{error}</span>
      )}
    </div>
  );
}
