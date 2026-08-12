"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel, Tag } from "@/components/ui";
import type { ResumeDocument, ResumeRationale } from "@/lib/resume/types";

interface ResumeView {
  id: number;
  content: ResumeDocument;
  rationale: ResumeRationale;
  integrityOk: boolean;
  integrityIssues: string[];
  approved: boolean;
  createdAt: string;
}

/**
 * The tailored resume, its rationale, and the approve/regenerate/download
 * controls. Shows what changed against the master and why, because a resume
 * you can't audit is a resume you can't send.
 */
export function ResumePanel({
  jobId,
  resume,
}: {
  jobId: number;
  resume: ResumeView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "changes">("preview");

  function call(path: string) {
    startTransition(async () => {
      setError(null);
      const response = await fetch(path, { method: "POST" });
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
    });
  }

  if (resume === null) {
    return (
      <Panel className="p-4">
        <h2 className="eyebrow mb-2">Tailored resume</h2>
        <p className="mb-3 text-muted">
          No resume generated for this job yet.
        </p>
        <button
          type="button"
          onClick={() => call(`/api/jobs/${jobId}/prepare`)}
          disabled={pending}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Generating…" : "Generate tailored resume"}
        </button>
        {error !== null && (
          <p className="mt-2 text-[11px] text-danger">{error}</p>
        )}
      </Panel>
    );
  }

  const changes = resume.rationale.changes ?? [];
  const rewritten = changes.filter((change) => change.kind === "bullet_rewritten");
  const omitted = changes.filter(
    (change) => change.kind === "bullet_omitted" || change.kind === "experience_omitted",
  );

  return (
    <Panel className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="eyebrow">Tailored resume</h2>

        {resume.integrityOk ? (
          <Tag>integrity ✓</Tag>
        ) : (
          <Tag tone="danger">integrity failed</Tag>
        )}
        {resume.approved && <Tag>approved</Tag>}

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex rounded-md border border-border p-0.5">
            {(["preview", "changes"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`rounded px-2 py-0.5 text-[11px] capitalize transition-colors ${
                  tab === value ? "bg-surface text-text" : "text-faint hover:text-muted"
                }`}
              >
                {value}
                {value === "changes" && changes.length > 0 && ` (${changes.length})`}
              </button>
            ))}
          </div>

          <a
            href={`/api/resume/${resume.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            PDF
          </a>
          <a
            href={`/api/resume/${resume.id}/pdf?download=1`}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Download
          </a>
          <button
            type="button"
            onClick={() => call(`/api/jobs/${jobId}/prepare`)}
            disabled={pending}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
          >
            Regenerate
          </button>
          <button
            type="button"
            onClick={() => call(`/api/resume/${resume.id}/approve`)}
            disabled={pending || resume.approved || !resume.integrityOk}
            title={
              resume.integrityOk
                ? undefined
                : "Fix the integrity issues before approving"
            }
            className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {resume.approved ? "Approved" : "Approve"}
          </button>
        </div>
      </div>

      {!resume.integrityOk && (
        <div className="mb-3 rounded-md bg-danger-soft p-2.5">
          <p className="mb-1 font-medium text-danger">
            This draft claims things your verified record does not support.
          </p>
          <ul className="flex list-inside list-disc flex-col gap-0.5 text-danger/90">
            {resume.integrityIssues.slice(0, 6).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {resume.rationale.summary && tab === "preview" && (
        <p className="mb-3 text-muted">{resume.rationale.summary}</p>
      )}

      {tab === "preview" ? (
        <ResumePreview document={resume.content} />
      ) : (
        <div className="flex flex-col gap-3">
          {changes.length === 0 && (
            <p className="text-faint">
              Identical to the master resume — nothing was cut or reworded.
            </p>
          )}

          {rewritten.length > 0 && (
            <div>
              <div className="eyebrow mb-1.5">Reworded ({rewritten.length})</div>
              <div className="flex flex-col gap-2">
                {rewritten.map((change, index) => (
                  <div key={`${change.bulletId}-${index}`} className="text-[12px]">
                    <p className="text-faint line-through">{change.before}</p>
                    <p className="text-text">{change.after}</p>
                    <p className="mt-0.5 text-[11px] text-accent">{change.why}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {omitted.length > 0 && (
            <div>
              <div className="eyebrow mb-1.5">Cut ({omitted.length})</div>
              <div className="flex flex-col gap-1.5">
                {omitted.map((change, index) => (
                  <div key={`${change.bulletId ?? change.experienceId}-${index}`}>
                    <p className="text-[12px] text-faint">
                      {change.before ?? `Experience ${change.experienceId}`}
                    </p>
                    <p className="text-[11px] text-muted">{change.why}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error !== null && <p className="mt-2 text-[11px] text-danger">{error}</p>}
    </Panel>
  );
}

/** A readable rendering of the document — not a pixel copy of the PDF. */
function ResumePreview({ document }: { document: ResumeDocument }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="text-center">
        <div className="text-[15px] font-semibold">{document.header.name}</div>
        <div className="mt-0.5 text-[11px] text-muted">
          {[
            document.header.location,
            document.header.phone,
            document.header.email,
            ...document.header.links.map((link) => link.label),
          ]
            .filter(Boolean)
            .join("  •  ")}
        </div>
      </div>

      <Section title="Education">
        <div className="flex items-baseline justify-between">
          <span className="font-medium">{document.education.university}</span>
          <span className="text-[11px] text-muted">
            {document.education.graduationLabel}
          </span>
        </div>
        <div className="text-[12px] italic text-muted">
          {document.education.degree}, {document.education.major}
          {document.education.minor && ` (Minor: ${document.education.minor})`}
          {document.education.gpa && ` — GPA ${document.education.gpa}`}
        </div>
      </Section>

      {document.sections.map((section) => (
        <Section key={section.title} title={section.title}>
          <div className="flex flex-col gap-2.5">
            {section.entries.map((entry) => (
              <div key={entry.experienceId}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{entry.organization}</span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {entry.dateRange}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-[12px] italic text-muted">
                  <span>{entry.title}</span>
                  {entry.location !== null && (
                    <span className="shrink-0">{entry.location}</span>
                  )}
                </div>
                <ul className="mt-1 flex list-outside list-disc flex-col gap-0.5 pl-4 text-[12px]">
                  {entry.bullets.map((bullet) => (
                    <li
                      key={bullet.bulletId}
                      className={bullet.rewritten ? "text-text" : "text-muted"}
                    >
                      {bullet.text}
                      {bullet.rewritten && (
                        <span
                          className="ml-1 text-[10px] text-accent"
                          title="Reworded for this posting"
                        >
                          ✎
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      ))}

      {document.skills.length > 0 && (
        <Section title="Skills">
          <div className="flex flex-col gap-0.5 text-[12px]">
            {document.skills.map((group) => (
              <div key={group.label}>
                <span className="font-medium">{group.label}: </span>
                <span className="text-muted">{group.items.join(", ")}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 border-b border-border-strong pb-0.5 text-[10px] font-semibold uppercase tracking-wider">
        {title}
      </div>
      {children}
    </div>
  );
}
