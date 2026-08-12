"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";
import {
  COMPONENT_KEYS,
  COMPONENT_LABELS,
  DEFAULT_WEIGHTS,
  type ScoringWeights,
} from "@/lib/scoring/weights";

/**
 * Scoring weight editor.
 *
 * The six components must total 100 so a score reads as a percentage; the form
 * shows the running total and refuses to save until it does.
 */
export function WeightsEditor({ initial }: { initial: ScoringWeights }) {
  const router = useRouter();
  const [weights, setWeights] = useState<ScoringWeights>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null,
  );

  const total = COMPONENT_KEYS.reduce((sum, key) => sum + weights[key], 0);
  const balanced = total === 100;
  const dirty = COMPONENT_KEYS.some((key) => weights[key] !== initial[key]) ||
    weights.companyPreferenceBonus !== initial.companyPreferenceBonus ||
    weights.minimumDisplayScore !== initial.minimumDisplayScore;

  function set(key: keyof ScoringWeights, value: number) {
    setWeights((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);

    const response = await fetch("/api/settings/weights", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(weights),
    });

    setSaving(false);

    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      setMessage({
        tone: "error",
        text:
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : "Could not save",
      });
      return;
    }

    setMessage({
      tone: "ok",
      text: "Saved. New scores use these weights; existing scores are kept for comparison.",
    });
    router.refresh();
  }

  return (
    <Panel className="p-4">
      <div className="grid gap-3 md:grid-cols-2">
        {COMPONENT_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-3">
            <span className="w-36 shrink-0">{COMPONENT_LABELS[key]}</span>
            <input
              type="range"
              min={0}
              max={50}
              value={weights[key]}
              onChange={(event) => set(key, Number(event.target.value))}
              className="flex-1 accent-accent"
            />
            <input
              type="number"
              min={0}
              max={50}
              value={weights[key]}
              onChange={(event) => set(key, Number(event.target.value))}
              className="w-14 rounded-md border border-border bg-surface px-1.5 py-1 text-right tabular-nums outline-none focus:border-accent"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
        <span className="w-36 shrink-0 text-muted">Component total</span>
        <span
          className={`text-[15px] font-semibold tabular-nums ${
            balanced ? "text-success" : "text-danger"
          }`}
        >
          {total}
        </span>
        {!balanced && (
          <span className="text-[11px] text-danger">
            must be 100 — {total > 100 ? `${total - 100} over` : `${100 - total} short`}
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-3 border-t border-border pt-3 md:grid-cols-2">
        <label className="flex items-center gap-3">
          <span className="w-36 shrink-0">
            Company preference
            <span className="block text-[11px] text-faint">± points, applied after</span>
          </span>
          <input
            type="number"
            min={0}
            max={20}
            value={weights.companyPreferenceBonus}
            onChange={(event) =>
              set("companyPreferenceBonus", Number(event.target.value))
            }
            className="w-16 rounded-md border border-border bg-surface px-1.5 py-1 text-right tabular-nums outline-none focus:border-accent"
          />
        </label>

        <label className="flex items-center gap-3">
          <span className="w-36 shrink-0">
            Discover floor
            <span className="block text-[11px] text-faint">default minimum score</span>
          </span>
          <input
            type="number"
            min={0}
            max={100}
            value={weights.minimumDisplayScore}
            onChange={(event) =>
              set("minimumDisplayScore", Number(event.target.value))
            }
            className="w-16 rounded-md border border-border bg-surface px-1.5 py-1 text-right tabular-nums outline-none focus:border-accent"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !balanced || !dirty}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save weights"}
        </button>
        <button
          type="button"
          onClick={() => {
            setWeights(DEFAULT_WEIGHTS);
            setMessage(null);
          }}
          className="rounded-md border border-border px-2.5 py-1.5 text-muted transition-colors hover:border-border-strong hover:text-text"
        >
          Reset to defaults
        </button>

        {message !== null && (
          <span
            className={message.tone === "ok" ? "text-success" : "text-danger"}
          >
            {message.text}
          </span>
        )}
      </div>
    </Panel>
  );
}
