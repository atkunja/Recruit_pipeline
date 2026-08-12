"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { APPLICATION_STATUSES } from "@/lib/types";
import { STATUS_LABELS } from "@/components/ui";

/**
 * Filter bar for Discover. State lives in the URL so a filtered view is
 * bookmarkable and the back button behaves.
 */
export function DiscoverFiltersBar({
  defaultMinScore,
}: {
  defaultMinScore: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value === "") next.delete(key);
      else next.set(key, value);
      router.push(`/discover?${next.toString()}`);
    },
    [params, router],
  );

  // "/" focuses search, the way every tool a power user already lives in does.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const minScore = params.get("minScore") ?? String(defaultMinScore);
  const inputClass =
    "rounded-md border border-border bg-surface px-2 py-1 text-text outline-none transition-colors focus:border-accent";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <input
        ref={searchRef}
        type="search"
        placeholder="Search company or role…  /"
        defaultValue={params.get("q") ?? ""}
        onKeyDown={(event) => {
          if (event.key === "Enter") update("q", event.currentTarget.value);
          if (event.key === "Escape") event.currentTarget.blur();
        }}
        className={`${inputClass} w-64`}
      />

      <label className="flex items-center gap-1.5 text-faint">
        <span className="eyebrow">Min fit</span>
        <select
          value={minScore}
          onChange={(event) => update("minScore", event.target.value)}
          className={inputClass}
        >
          <option value="">Any</option>
          <option value="60">60+</option>
          <option value="70">70+</option>
          <option value="80">80+</option>
          <option value="85">85+</option>
          <option value="90">90+</option>
          <option value="95">95+</option>
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-faint">
        <span className="eyebrow">Found</span>
        <select
          value={params.get("since") ?? ""}
          onChange={(event) => update("since", event.target.value)}
          className={inputClass}
        >
          <option value="">Any time</option>
          <option value="1d">Last 24h</option>
          <option value="3d">Last 3 days</option>
          <option value="7d">Last week</option>
          <option value="30d">Last month</option>
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-faint">
        <span className="eyebrow">Status</span>
        <select
          value={params.get("status") ?? ""}
          onChange={(event) => update("status", event.target.value)}
          className={inputClass}
        >
          <option value="">Any</option>
          <option value="none">Not started</option>
          {APPLICATION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>

      <input
        type="search"
        placeholder="Location"
        defaultValue={params.get("location") ?? ""}
        onKeyDown={(event) => {
          if (event.key === "Enter") update("location", event.currentTarget.value);
        }}
        className={`${inputClass} w-36`}
      />

      <label className="flex items-center gap-1.5 text-faint">
        <span className="eyebrow">Sort</span>
        <select
          value={params.get("sort") ?? "score"}
          onChange={(event) => update("sort", event.target.value)}
          className={inputClass}
        >
          <option value="score">Fit score</option>
          <option value="discovered">Recently found</option>
          <option value="posted">Recently posted</option>
        </select>
      </label>

      <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-faint">
        <input
          type="checkbox"
          checked={params.get("ignored") === "1"}
          onChange={(event) => update("ignored", event.target.checked ? "1" : "")}
          className="accent-accent"
        />
        Show ignored
      </label>

      {params.toString() !== "" && (
        <button
          type="button"
          onClick={() => router.push("/discover")}
          className="ml-auto rounded-md px-2 py-1 text-faint transition-colors hover:text-text"
        >
          Reset
        </button>
      )}
    </div>
  );
}
