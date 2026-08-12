"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel, Tag, relativeTime } from "@/components/ui";
import type { JobSource } from "@/lib/types";

interface RunResult {
  sourcesRun: number;
  jobsNew: number;
  jobsDuplicate: number;
  scored: number;
  enriched: number;
  budgetStopped: boolean;
  errors: { source: string; error: string }[];
}

/** Discovery source list: enable, disable, and run on demand. */
export function SourcesTable({ sources }: { sources: JobSource[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const enabled = sources.filter((source) => source.enabled).length;
  const failing = sources.filter((source) => source.consecutiveFailures > 0);

  const visible = sources.filter(
    (source) =>
      filter === "" ||
      source.name.toLowerCase().includes(filter.toLowerCase()) ||
      source.kind.includes(filter.toLowerCase()),
  );

  async function toggle(source: JobSource) {
    setBusy(source.id);
    await fetch(`/api/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !source.enabled }),
    });
    setBusy(null);
    router.refresh();
  }

  async function run(sourceIds?: number[]) {
    setBusy(sourceIds === undefined ? "all" : (sourceIds[0] ?? null));
    setResult(null);
    setError(null);

    const response = await fetch("/api/sources/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sourceIds === undefined ? {} : { sourceIds }),
    });

    setBusy(null);

    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      setError(
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `Run failed (${response.status})`,
      );
      return;
    }

    setResult((await response.json()) as RunResult);
    router.refresh();
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-muted">
          <span className="font-medium text-text">{enabled}</span> of{" "}
          {sources.length} enabled
        </span>
        {failing.length > 0 && (
          <Tag tone="danger">{failing.length} failing</Tag>
        )}

        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter sources…"
          className="ml-auto w-48 rounded-md border border-border bg-surface px-2 py-1 outline-none transition-colors focus:border-accent"
        />

        <button
          type="button"
          onClick={() => run()}
          disabled={busy !== null}
          className="rounded-md bg-accent px-2.5 py-1 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy === "all" ? "Running…" : "Run discovery"}
        </button>
      </div>

      {result !== null && (
        <div className="border-b border-border bg-surface px-3 py-2">
          <p className="text-muted">
            <span className="text-text">{result.jobsNew}</span> new ·{" "}
            {result.jobsDuplicate} duplicates · {result.enriched} descriptions
            fetched · <span className="text-text">{result.scored}</span> scored
            across {result.sourcesRun} sources
          </p>
          {result.budgetStopped && (
            <p className="mt-0.5 text-warn">
              Stopped scoring early — monthly AI budget reached.
            </p>
          )}
          {result.errors.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-danger">
                {result.errors.length} source(s) failed
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-faint">
                {result.errors.slice(0, 10).map((item) => (
                  <li key={item.source}>
                    {item.source}: {item.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {error !== null && (
        <p className="border-b border-border px-3 py-2 text-danger">{error}</p>
      )}

      <div className="max-h-[520px] overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-panel">
            <tr className="border-b border-border text-left">
              <th className="px-3 py-1.5 font-medium text-faint">Source</th>
              <th className="px-3 py-1.5 font-medium text-faint">Kind</th>
              <th className="px-3 py-1.5 font-medium text-faint">Last run</th>
              <th className="px-3 py-1.5 font-medium text-faint">Status</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {visible.map((source) => (
              <tr
                key={source.id}
                className={`row-hover border-b border-border/60 ${
                  source.enabled ? "" : "opacity-50"
                }`}
              >
                <td className="px-3 py-1.5">{source.name}</td>
                <td className="px-3 py-1.5 text-faint">{source.kind}</td>
                <td className="px-3 py-1.5 text-faint">
                  {relativeTime(source.lastRunAt)}
                </td>
                <td className="px-3 py-1.5">
                  {source.lastStatus === null ? (
                    <span className="text-faint">never run</span>
                  ) : source.lastStatus === "ok" ? (
                    <span className="text-success">ok</span>
                  ) : (
                    <span className="text-danger" title={source.lastError ?? ""}>
                      error ×{source.consecutiveFailures}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => run([source.id])}
                      disabled={busy !== null}
                      className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
                    >
                      {busy === source.id ? "…" : "Run"}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(source)}
                      disabled={busy !== null}
                      className="rounded border border-border px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
                    >
                      {source.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-faint">
            No sources match “{filter}”.
          </p>
        )}
      </div>
    </Panel>
  );
}
