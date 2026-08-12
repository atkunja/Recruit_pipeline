import type { ReactNode } from "react";
import type { ApplicationStatus } from "@/lib/types";

/** Small shared presentational primitives. Kept in one file on purpose. */

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight">{title}</h1>
        {subtitle !== undefined && (
          <p className="mt-0.5 text-muted">{subtitle}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/**
 * Fit score chip. Colour encodes the band, not a gradient — a 91 and an 88
 * should look meaningfully different at a glance.
 */
export function ScoreBadge({
  score,
  size = "md",
}: {
  score: number | null;
  size?: "sm" | "md" | "lg";
}) {
  const dimensions =
    size === "lg"
      ? "h-11 w-11 text-[15px]"
      : size === "sm"
        ? "h-6 w-9 text-[11px]"
        : "h-8 w-11 text-[13px]";

  if (score === null) {
    return (
      <div
        className={`grid shrink-0 place-items-center rounded-md border border-border bg-surface font-semibold text-faint ${dimensions}`}
        title="Not scored yet"
      >
        —
      </div>
    );
  }

  const tone =
    score >= 90
      ? "bg-success-soft text-success border-success/25"
      : score >= 80
        ? "bg-accent-soft text-accent border-accent/30"
        : score >= 70
          ? "bg-warn-soft text-warn border-warn/25"
          : "bg-surface text-muted border-border";

  return (
    <div
      className={`grid shrink-0 place-items-center rounded-md border font-semibold tabular-nums ${tone} ${dimensions}`}
      title={`Fit score ${score}/100`}
    >
      {score}
    </div>
  );
}

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  discovered: "bg-surface text-muted",
  preparing: "bg-info-soft text-info",
  ready_to_apply: "bg-accent-soft text-accent",
  applied: "bg-success-soft text-success",
  outreach_sent: "bg-accent-soft text-accent",
  oa: "bg-warn-soft text-warn",
  interview: "bg-warn-soft text-warn",
  rejected: "bg-danger-soft text-danger",
  offer: "bg-success-soft text-success",
  withdrawn: "bg-surface text-faint",
};

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  discovered: "Discovered",
  preparing: "Preparing",
  ready_to_apply: "Ready to apply",
  applied: "Applied",
  outreach_sent: "Outreach sent",
  oa: "OA",
  interview: "Interview",
  rejected: "Rejected",
  offer: "Offer",
  withdrawn: "Withdrawn",
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Tag({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "muted" | "danger";
}) {
  const styles =
    tone === "danger"
      ? "bg-danger-soft text-danger"
      : tone === "muted"
        ? "bg-surface text-faint"
        : "bg-surface text-muted";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] ${styles}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      {hint !== undefined && (
        <p className="mt-1 max-w-md text-muted">{hint}</p>
      )}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "danger";
}) {
  const valueTone =
    tone === "good"
      ? "text-success"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : "text-text";

  return (
    <div className="panel px-3 py-2.5">
      <div className="eyebrow">{label}</div>
      <div className={`mt-1 text-[20px] font-semibold tabular-nums ${valueTone}`}>
        {value}
      </div>
      {hint !== undefined && (
        <div className="mt-0.5 text-[11px] text-faint">{hint}</div>
      )}
    </div>
  );
}

/** Relative time, e.g. "3h ago". Rendered server-side; no locale surprises. */
export function relativeTime(date: Date | string | null): string {
  if (date === null) return "—";
  const value = date instanceof Date ? date : new Date(date);
  const seconds = Math.floor((Date.now() - value.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;

  const days = Math.floor(seconds / 86400);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
