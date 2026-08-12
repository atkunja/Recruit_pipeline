import Link from "next/link";
import { notFound } from "next/navigation";
import { getDuplicates, getJobDetail } from "@/lib/jobs/repository";
import { getApplicationByJob } from "@/lib/applications/repository";
import { getLatestResumeForJob } from "@/lib/resume/repository";
import { getApplicationTimeline } from "@/lib/activity";
import { sql } from "@/lib/db";
import { COMPONENT_LABELS } from "@/lib/scoring/weights";
import {
  Panel,
  ScoreBadge,
  StatusBadge,
  Tag,
  relativeTime,
} from "@/components/ui";
import { ResumePanel } from "./resume-panel";
import { JobActions } from "./actions";
import type { JobScore, ScoreComponentKey } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) notFound();

  const job = await getJobDetail(jobId);
  if (!job) notFound();

  const [scores, application, resume, duplicates] = await Promise.all([
    sql<JobScore[]>`
      select * from job_scores where job_id = ${jobId}
      order by created_at desc limit 1
    `,
    getApplicationByJob(jobId),
    getLatestResumeForJob(jobId),
    getDuplicates(jobId),
  ]);

  const score = scores[0] ?? null;
  const timeline = application
    ? await getApplicationTimeline(application.id)
    : [];

  return (
    <>
      <div className="mb-4 flex items-start gap-4">
        <ScoreBadge score={score?.total ?? null} size="lg" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[17px] font-semibold tracking-tight">
              {job.companyName}
            </h1>
            {application !== null && <StatusBadge status={application.status} />}
            {job.isIgnored && <Tag tone="danger">Ignored</Tag>}
          </div>
          <p className="text-muted">{job.title}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-faint">
            <span>{job.locationRaw ?? "Location not listed"}</span>
            {job.season !== null && <span>· {job.season}</span>}
            <span>· via {job.sourceKind}</span>
            <span>· found {relativeTime(job.discoveredAt)}</span>
            {job.postedAt !== null && <span>· posted {relativeTime(job.postedAt)}</span>}
            {job.compensation !== null && <span>· {job.compensation}</span>}
          </div>

          {job.prefilter === "reject" && (
            <p className="mt-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-danger">
              Filtered out: {job.prefilterReasons.join(", ")}
            </p>
          )}
        </div>

        <JobActions
          jobId={job.id}
          jobUrl={job.url}
          isIgnored={job.isIgnored}
          hasApplication={application !== null}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          {score !== null && <ScoreBreakdown score={score} />}

          <ResumePanel
            jobId={job.id}
            resume={
              resume === null
                ? null
                : {
                    id: resume.id,
                    content: resume.content,
                    rationale: resume.rationale,
                    integrityOk: resume.integrityOk,
                    integrityIssues: resume.integrityIssues,
                    approved: resume.approved,
                    createdAt: String(resume.createdAt),
                  }
            }
          />

          <Panel className="p-4">
            <h2 className="eyebrow mb-2">Job description</h2>
            {job.description === null ? (
              <p className="text-faint">
                No description captured.{" "}
                <a
                  href={job.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent hover:underline"
                >
                  Open the posting
                </a>
                .
              </p>
            ) : (
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap font-sans text-muted">
                {job.description}
              </pre>
            )}
          </Panel>
        </div>

        <aside className="flex flex-col gap-4">
          {score !== null && <ScoreDetails score={score} />}

          {duplicates.length > 0 && (
            <Panel className="p-3">
              <h2 className="eyebrow mb-2">Also listed on</h2>
              <ul className="flex flex-col gap-1">
                {duplicates.map((duplicate) => (
                  <li key={duplicate.id}>
                    <a
                      href={duplicate.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-muted transition-colors hover:text-accent"
                    >
                      {duplicate.sourceKind} · {relativeTime(duplicate.discoveredAt)}
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {timeline.length > 0 && (
            <Panel className="p-3">
              <h2 className="eyebrow mb-2">Timeline</h2>
              <ol className="flex flex-col gap-1.5">
                {timeline.map((event) => (
                  <li key={event.id} className="flex gap-2">
                    <span className="w-14 shrink-0 text-[11px] text-faint">
                      {new Date(event.at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="text-muted">{event.message}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          <Panel className="p-3">
            <h2 className="eyebrow mb-2">Source</h2>
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all text-accent hover:underline"
            >
              {job.url}
            </a>
            {job.companyWebsite !== null && (
              <div className="mt-2">
                <Link
                  href={`/discover?company=${job.companyId}`}
                  className="text-muted hover:text-text"
                >
                  All {job.companyName} jobs →
                </Link>
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}

function ScoreBreakdown({ score }: { score: JobScore }) {
  const entries = Object.entries(score.components) as [
    ScoreComponentKey,
    { score: number; max: number; reason: string },
  ][];

  return (
    <Panel className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="eyebrow">Why this score</h2>
        <span className="tabular-nums text-muted">
          <span className="text-[17px] font-semibold text-text">{score.total}</span>
          /100
        </span>
      </div>

      {score.summary !== null && (
        <p className="mb-3 text-muted">{score.summary}</p>
      )}

      <div className="flex flex-col gap-2">
        {entries.map(([key, component]) => (
          <div key={key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{COMPONENT_LABELS[key]}</span>
              <span className="shrink-0 tabular-nums text-muted">
                {component.score}/{component.max}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${component.max === 0 ? 0 : (component.score / component.max) * 100}%`,
                }}
              />
            </div>
            <p className="mt-1 text-[11px] text-faint">{component.reason}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ScoreDetails({ score }: { score: JobScore }) {
  const sections = (
    [
      { label: "Strongest skills", items: score.strongestSkills, tone: "default" },
      { label: "Emphasise", items: score.emphasize, tone: "default" },
      { label: "Missing", items: score.missingRequirements, tone: "danger" },
      { label: "Concerns", items: score.concerns, tone: "danger" },
    ] satisfies { label: string; items: string[]; tone: "default" | "danger" }[]
  ).filter((section) => section.items.length > 0);

  if (sections.length === 0) return null;

  return (
    <Panel className="p-3">
      <h2 className="eyebrow mb-2">Analysis</h2>
      <div className="flex flex-col gap-2.5">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="mb-1 text-[11px] text-faint">{section.label}</div>
            <div className="flex flex-wrap gap-1">
              {section.items.map((item) => (
                <Tag key={item} tone={section.tone}>
                  {item}
                </Tag>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
