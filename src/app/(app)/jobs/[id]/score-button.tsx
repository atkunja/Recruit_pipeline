"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";

/**
 * On-demand scoring.
 *
 * Discovery no longer scores everything it finds, because scoring was the
 * largest share of model spend on a feature that is only useful when comparing
 * a shortlist. This is how a score gets produced for one job you care about.
 */
export function ScoreButton({ jobId }: { jobId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function score() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/jobs/${jobId}/score`, { method: "POST" });
    setBusy(false);

    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      setError(
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `Failed (${response.status})`,
      );
      return;
    }
    router.refresh();
  }

  return (
    <Panel className="p-3">
      <h2 className="eyebrow mb-1.5">Fit score</h2>
      <p className="mb-2.5 text-[11px] text-faint">
        Not scored yet. Scoring reads this posting against your profile and
        costs about a fortieth of a cent.
      </p>
      <button
        type="button"
        onClick={score}
        disabled={busy}
        className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "Scoring…" : "Score this job"}
      </button>
      {error !== null && (
        <p className="mt-2 text-[11px] text-danger">{error}</p>
      )}
    </Panel>
  );
}
