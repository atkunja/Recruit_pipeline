"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Panel, ScoreBadge, Tag } from "@/components/ui";

interface Question {
  id: number;
  question: string;
  answer: string | null;
  needsReview: boolean;
  isSensitive: boolean;
}

interface ApplyJob {
  applicationId: number;
  jobId: number;
  title: string;
  url: string;
  company: string;
  location: string | null;
  pay: string | null;
  score: number | null;
  resumeVersionId: number | null;
  resumeReady: boolean;
  questions: Question[];
}

interface ProfileFacts {
  fullName: string;
  email: string;
  phone: string | null;
  location: string | null;
  university: string;
  degree: string;
  graduation: string;
  gpa: string | null;
  github: string | null;
  linkedin: string | null;
  portfolio: string | null;
  workAuthorization: string;
  sponsorship: string;
}

/** Copy-to-clipboard button that confirms it worked. */
function Copy({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
        copied
          ? "border-success/40 bg-success-soft text-success"
          : "border-border text-faint hover:border-border-strong hover:text-text"
      }`}
    >
      {copied ? "copied" : (label ?? "copy")}
    </button>
  );
}

/**
 * One prepared application at a time, with everything an autofill extension
 * can't supply within reach: the tailored resume, the essay answers, and the
 * profile facts. Keyboard-first — o opens, r downloads, a records, s skips.
 */
export function ApplyDeck({
  jobs,
  profile,
}: {
  jobs: ApplyJob[];
  profile: ProfileFacts | null;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const remaining = jobs.filter((job) => !done.has(job.applicationId));
  const job = remaining[Math.min(index, remaining.length - 1)];

  const advance = useCallback(() => {
    setIndex((current) => (current + 1 >= remaining.length ? 0 : current + 1));
  }, [remaining.length]);

  const open = useCallback(() => {
    if (job) window.open(job.url, "_blank", "noopener,noreferrer");
  }, [job]);

  const download = useCallback(() => {
    if (job?.resumeVersionId != null) {
      window.open(`/api/resume/${job.resumeVersionId}/pdf?download=1`, "_blank");
    }
  }, [job]);

  const markApplied = useCallback(async () => {
    if (!job || busy) return;
    setBusy(true);
    const response = await fetch(`/api/jobs/${job.jobId}/applied`, { method: "POST" });
    setBusy(false);
    if (response.ok) {
      setDone((current) => new Set(current).add(job.applicationId));
      setIndex(0);
      router.refresh();
    }
  }, [job, busy, router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key.toLowerCase()) {
        case "o": event.preventDefault(); open(); break;
        case "r": event.preventDefault(); download(); break;
        case "a": event.preventDefault(); void markApplied(); break;
        case "s": case "j": event.preventDefault(); advance(); break;
        default: break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, download, markApplied, advance]);

  if (!job) {
    return (
      <Panel className="px-4 py-10 text-center">
        <p className="font-medium">Queue cleared.</p>
        <p className="mt-1 text-muted">
          {done.size} application{done.size === 1 ? "" : "s"} recorded this session.
        </p>
        <Link
          href="/discover"
          className="mt-4 inline-block rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg"
        >
          Find more
        </Link>
      </Panel>
    );
  }

  const answered = job.questions.filter(
    (question) => question.answer !== null && !question.needsReview,
  );
  const flagged = job.questions.filter(
    (question) => question.needsReview || question.answer === null,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-3">
        <Panel className="p-4">
          <div className="flex items-start gap-3">
            <ScoreBadge score={job.score} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[15px] font-semibold">{job.company}</span>
                <span className="text-muted">{job.title}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                <span>{job.location ?? "Location not listed"}</span>
                {job.pay !== null && (
                  <span className="font-medium text-success">{job.pay}</span>
                )}
                {job.resumeReady ? (
                  <Tag>resume approved</Tag>
                ) : (
                  <Tag tone="danger">resume not approved</Tag>
                )}
                {flagged.length > 0 && (
                  <Tag tone="danger">{flagged.length} question(s) need you</Tag>
                )}
              </div>
            </div>
            <span className="shrink-0 text-[11px] text-faint">
              {remaining.length} left
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={open}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              Open posting <kbd className="ml-1 opacity-60">o</kbd>
            </button>
            <button
              type="button"
              onClick={download}
              disabled={job.resumeVersionId === null}
              className="rounded-md border border-border px-2.5 py-1.5 text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
            >
              Download resume <kbd className="ml-1 opacity-60">r</kbd>
            </button>
            <Link
              href={`/applications/${job.applicationId}`}
              className="rounded-md border border-border px-2.5 py-1.5 text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              Review
            </Link>

            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={advance}
                className="rounded-md border border-border px-2.5 py-1.5 text-faint transition-colors hover:border-border-strong hover:text-text"
              >
                Skip <kbd className="ml-1 opacity-60">s</kbd>
              </button>
              <button
                type="button"
                onClick={() => void markApplied()}
                disabled={busy}
                className="rounded-md bg-success px-3 py-1.5 font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? "Saving…" : "I applied"} <kbd className="ml-1 opacity-60">a</kbd>
              </button>
            </div>
          </div>
        </Panel>

        <Panel className="p-4">
          <h2 className="eyebrow mb-2">
            Answers — the part autofill leaves blank
          </h2>

          {job.questions.length === 0 ? (
            <p className="text-faint">
              No answers prepared.{" "}
              <Link href={`/applications/${job.applicationId}`} className="text-accent hover:underline">
                Prepare them
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {answered.map((question) => (
                <div key={question.id}>
                  <div className="mb-0.5 flex items-baseline gap-2">
                    <span className="font-medium">{question.question}</span>
                    <span className="ml-auto">
                      <Copy value={question.answer ?? ""} />
                    </span>
                  </div>
                  <p className="rounded-md border border-border bg-surface px-2.5 py-1.5 leading-relaxed text-muted">
                    {question.answer}
                  </p>
                </div>
              ))}

              {flagged.length > 0 && (
                <div className="rounded-md bg-warn-soft px-2.5 py-2">
                  <p className="mb-1 font-medium text-warn">
                    {flagged.length} question{flagged.length === 1 ? "" : "s"} for you
                  </p>
                  <ul className="flex list-inside list-disc flex-col gap-0.5 text-warn/90">
                    {flagged.map((question) => (
                      <li key={question.id}>
                        {question.question}
                        {question.isSensitive && " (self-identification — answer on the form)"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>

      <aside className="flex flex-col gap-3">
        <Panel className="p-3">
          <h2 className="eyebrow mb-2">Your details</h2>
          {profile === null ? (
            <p className="text-faint">No profile seeded.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {(
                [
                  ["Name", profile.fullName],
                  ["Email", profile.email],
                  ["Phone", profile.phone],
                  ["Location", profile.location],
                  ["School", profile.university],
                  ["Degree", profile.degree],
                  ["Graduation", profile.graduation],
                  ["GPA", profile.gpa],
                  ["Work auth", profile.workAuthorization],
                  ["Sponsorship", profile.sponsorship],
                  ["GitHub", profile.github],
                  ["LinkedIn", profile.linkedin],
                  ["Portfolio", profile.portfolio],
                ] as [string, string | null][]
              )
                .filter(([, value]) => value !== null && value !== "")
                .map(([label, value]) => (
                  <div key={label} className="flex items-baseline gap-2">
                    <span className="w-20 shrink-0 text-[11px] text-faint">{label}</span>
                    <span className="min-w-0 flex-1 truncate" title={value ?? ""}>
                      {value}
                    </span>
                    <Copy value={value ?? ""} />
                  </div>
                ))}
            </div>
          )}
        </Panel>

        <Panel className="p-3">
          <h2 className="eyebrow mb-1.5">Shortcuts</h2>
          <div className="flex flex-col gap-0.5 text-[11px] text-faint">
            <span><kbd className="text-muted">o</kbd> open the posting</span>
            <span><kbd className="text-muted">r</kbd> download the tailored resume</span>
            <span><kbd className="text-muted">a</kbd> record that you applied</span>
            <span><kbd className="text-muted">s</kbd> skip to the next</span>
          </div>
          <p className="mt-2 text-[11px] text-faint">
            Let your autofill extension handle name, email and links. This screen
            covers what it can&apos;t: the per-job resume and the written answers.
          </p>
        </Panel>
      </aside>
    </div>
  );
}
