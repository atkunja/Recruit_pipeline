import Link from "next/link";
import { sql } from "@/lib/db";
import {
  EmptyState,
  PageHeader,
  Panel,
  Stat,
  Tag,
  relativeTime,
} from "@/components/ui";
import type { InterviewKind, InterviewStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

interface InterviewRow {
  id: number;
  applicationId: number;
  kind: InterviewKind;
  status: InterviewStatus;
  scheduledAt: Date | null;
  dueAt: Date | null;
  location: string | null;
  meetingUrl: string | null;
  notes: string | null;
  companyName: string;
  jobTitle: string;
  jobId: number;
}

interface TaskRow {
  id: number;
  kind: string;
  title: string;
  detail: string | null;
  dueAt: Date | null;
  jobId: number | null;
}

const KIND_LABELS: Record<InterviewKind, string> = {
  oa: "Online assessment",
  phone_screen: "Phone screen",
  technical: "Technical",
  behavioral: "Behavioral",
  onsite: "Onsite",
  final: "Final round",
};

export default async function InterviewsPage() {
  const [interviews, tasks] = await Promise.all([
    sql<InterviewRow[]>`
      select
        i.id, i.application_id, i.kind, i.status, i.scheduled_at, i.due_at,
        i.location, i.meeting_url, i.notes,
        co.name as company_name, j.title as job_title, j.id as job_id
      from interviews i
      join applications a on a.id = i.application_id
      join jobs j        on j.id = a.job_id
      join companies co  on co.id = j.company_id
      order by
        case when i.status = 'scheduled' then 0 else 1 end,
        coalesce(i.scheduled_at, i.due_at) asc nulls last,
        i.created_at desc
    `,
    sql<TaskRow[]>`
      select id, kind, title, detail, due_at, job_id
      from tasks
      where status = 'open'
      order by due_at asc nulls last
      limit 30
    `,
  ]);

  const upcoming = interviews.filter((row) => row.status === "scheduled");
  const past = interviews.filter((row) => row.status !== "scheduled");
  const assessments = upcoming.filter((row) => row.kind === "oa");

  return (
    <>
      <PageHeader
        title="Interviews"
        subtitle={`${upcoming.length} scheduled · ${tasks.length} open task${tasks.length === 1 ? "" : "s"}`}
      />

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat
          label="Assessments due"
          value={assessments.length}
          tone={assessments.length > 0 ? "warn" : "default"}
        />
        <Stat label="Interviews scheduled" value={upcoming.length - assessments.length} />
        <Stat label="Completed" value={past.length} />
        <Stat label="Open tasks" value={tasks.length} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <h2 className="eyebrow mb-2">Upcoming</h2>
          {upcoming.length === 0 ? (
            <EmptyState
              title="Nothing scheduled"
              hint="Assessments and interviews detected in your email land here automatically, and you can add them by hand from an application."
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {upcoming.map((interview) => (
                <Link
                  key={interview.id}
                  href={`/jobs/${interview.jobId}`}
                  className="panel row-hover flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{interview.companyName}</span>
                      <span className="truncate text-muted">{interview.jobTitle}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                      <Tag tone={interview.kind === "oa" ? "danger" : "default"}>
                        {KIND_LABELS[interview.kind]}
                      </Tag>
                      {interview.scheduledAt !== null && (
                        <span>
                          {new Date(interview.scheduledAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                      {interview.dueAt !== null && (
                        <span className="text-warn">
                          due {relativeTime(interview.dueAt)}
                        </span>
                      )}
                      {interview.location !== null && <span>· {interview.location}</span>}
                    </div>
                    {interview.notes !== null && (
                      <p className="mt-1 truncate text-[11px] text-faint">
                        {interview.notes}
                      </p>
                    )}
                  </div>

                  {interview.meetingUrl !== null && (
                    <span className="shrink-0 text-[11px] text-accent">Join →</span>
                  )}
                </Link>
              ))}
            </div>
          )}

          {past.length > 0 && (
            <>
              <h2 className="eyebrow mb-2 mt-5">History</h2>
              <Panel className="divide-y divide-border">
                {past.map((interview) => (
                  <div key={interview.id} className="flex items-baseline gap-2 px-3 py-2">
                    <span className="font-medium">{interview.companyName}</span>
                    <span className="truncate text-muted">
                      {KIND_LABELS[interview.kind]}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-faint">
                      {interview.status}
                    </span>
                  </div>
                ))}
              </Panel>
            </>
          )}
        </section>

        <aside>
          <h2 className="eyebrow mb-2">Open tasks</h2>
          {tasks.length === 0 ? (
            <Panel className="px-3 py-6 text-center text-faint">
              Nothing needs your attention.
            </Panel>
          ) : (
            <Panel className="divide-y divide-border">
              {tasks.map((task) => (
                <div key={task.id} className="px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate">{task.title}</span>
                    {task.dueAt !== null && (
                      <span className="ml-auto shrink-0 text-[11px] text-faint">
                        {relativeTime(task.dueAt)}
                      </span>
                    )}
                  </div>
                  {task.detail !== null && (
                    <p className="mt-0.5 text-[11px] text-faint">{task.detail}</p>
                  )}
                  {task.jobId !== null && (
                    <Link
                      href={`/jobs/${task.jobId}`}
                      className="mt-1 inline-block text-[11px] text-accent hover:underline"
                    >
                      Open →
                    </Link>
                  )}
                </div>
              ))}
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
