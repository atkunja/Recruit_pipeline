"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";
import type { ScoringMode } from "@/lib/settings";

const OPTIONS: {
  value: ScoringMode;
  label: string;
  detail: string;
}[] = [
  {
    value: "on_demand",
    label: "Only when I ask",
    detail:
      "Discovery finds and files jobs for free. A score is generated when you open a job and press Score, or automatically when you press Prepare.",
  },
  {
    value: "auto",
    label: "Score everything automatically",
    detail:
      "Every discovery run scores what it found. Useful if you want the feed ranked by fit without touching it, at roughly a quarter of a cent per job.",
  },
  {
    value: "off",
    label: "Never score",
    detail:
      "No fit scores at all. Discover still works — it sorts by newest and shows pay — and resume tailoring still runs when you prepare an application.",
  },
];

/**
 * How aggressively to spend on fit scores.
 *
 * Scoring was 66% of all model spend while being the feature the user reaches
 * for least, so it defaults to on-demand rather than running on a schedule.
 */
export function ScoringModeControl({
  mode,
  monthlySpend,
  scoredCount,
  unscoredCount,
}: {
  mode: ScoringMode;
  monthlySpend: number;
  scoredCount: number;
  unscoredCount: number;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<ScoringMode>(mode);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function choose(value: ScoringMode) {
    const previous = current;
    setCurrent(value);
    setSaving(true);
    setNote(null);

    const response = await fetch("/api/settings/scoring-mode", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: value }),
    });

    setSaving(false);
    if (!response.ok) {
      setCurrent(previous);
      setNote("Could not save that.");
      return;
    }
    setNote("Saved.");
    router.refresh();
  }

  // ~$0.00025 per score after the prompt was trimmed and the cheap tier moved
  // to a nano model; the earlier measured figure was $0.00168.
  const perScore = 0.00025;
  const estimate = (unscoredCount * perScore).toFixed(2);

  return (
    <Panel className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h3 className="font-medium">When to score jobs</h3>
        <span className="text-[11px] text-faint">
          {scoredCount} scored · {unscoredCount} not scored · ${monthlySpend.toFixed(2)} spent
          this month
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer gap-2.5 rounded-md border p-2.5 transition-colors ${
              current === option.value
                ? "border-accent bg-accent-soft"
                : "border-border hover:border-border-strong"
            }`}
          >
            <input
              type="radio"
              name="scoringMode"
              checked={current === option.value}
              onChange={() => choose(option.value)}
              disabled={saving}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="font-medium">{option.label}</span>
              {option.value === "on_demand" && (
                <span className="ml-1.5 text-[10px] uppercase tracking-wide text-accent">
                  default
                </span>
              )}
              <span className="mt-0.5 block text-[11px] text-muted">
                {option.detail}
              </span>
            </span>
          </label>
        ))}
      </div>

      <p className="mt-2.5 text-[11px] text-faint">
        Scoring everything you currently have unscored would cost about ${estimate}.
        Scores are cached per job, so nothing is ever paid for twice.
        {note !== null && <span className="ml-1.5 text-success">{note}</span>}
      </p>
    </Panel>
  );
}
