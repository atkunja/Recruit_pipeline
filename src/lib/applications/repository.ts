import "server-only";
import { sql } from "../db";
import { logActivity } from "../activity";
import type { Application, ApplicationStatus, JobListItem } from "../types";

/** Application lifecycle: create, advance, and query. */

/** Human-readable timeline copy for each status transition. */
const STATUS_MESSAGES: Record<ApplicationStatus, string> = {
  discovered: "Job discovered",
  preparing: "Preparation started",
  ready_to_apply: "Ready to apply",
  applied: "Applied",
  outreach_sent: "Outreach sent",
  oa: "Online assessment received",
  interview: "Interview scheduled",
  rejected: "Rejected",
  offer: "Offer received",
  withdrawn: "Withdrawn",
};

/**
 * Get the application for a job, creating one if it does not exist.
 * The unique index on `job_id` makes the upsert the concurrency-safe path.
 */
export async function ensureApplication(
  jobId: number,
  status: ApplicationStatus = "discovered",
): Promise<Application> {
  const rows = await sql<Application[]>`
    insert into applications (job_id, status)
    values (${jobId}, ${status})
    on conflict (job_id) do update
      set updated_at = now()
    returning *
  `;
  const application = rows[0];
  if (!application) throw new Error(`Failed to create application for job ${jobId}`);
  return application;
}

export async function getApplicationByJob(
  jobId: number,
): Promise<Application | null> {
  const rows = await sql<Application[]>`
    select * from applications where job_id = ${jobId}
  `;
  return rows[0] ?? null;
}

export async function getApplication(id: number): Promise<Application | null> {
  const rows = await sql<Application[]>`
    select * from applications where id = ${id}
  `;
  return rows[0] ?? null;
}

/**
 * Move an application to a new status, stamping the matching timestamp and
 * writing a timeline event.
 */
export async function setStatus(
  applicationId: number,
  status: ApplicationStatus,
  detail?: string,
): Promise<Application> {
  const rows = await sql<Application[]>`
    update applications set
      status      = ${status},
      applied_at  = case
        when ${status} = 'applied' and applied_at is null then now()
        else applied_at
      end,
      prepared_at = case
        when ${status} in ('ready_to_apply', 'applied') and prepared_at is null then now()
        else prepared_at
      end,
      closed_at   = case
        when ${status} in ('rejected', 'offer', 'withdrawn') then now()
        else null
      end,
      updated_at  = now()
    where id = ${applicationId}
    returning *
  `;

  const application = rows[0];
  if (!application) throw new Error(`No application ${applicationId}`);

  await logActivity({
    kind: "status_changed",
    message: detail ?? STATUS_MESSAGES[status],
    applicationId: application.id,
    jobId: application.jobId,
    meta: { status },
  });

  return application;
}

export async function setResumeVersion(
  applicationId: number,
  resumeVersionId: number,
): Promise<void> {
  await sql`
    update applications
    set resume_version_id = ${resumeVersionId}, updated_at = now()
    where id = ${applicationId}
  `;
}

export type ApplicationListItem = JobListItem & {
  applicationId: number;
  applicationStatus: ApplicationStatus;
  priority: number;
  appliedAt: Date | null;
  updatedAt: Date;
  nextAction: string | null;
  nextActionAt: Date | null;
  hasResume: boolean;
  outreachCount: number;
};

/** Applications in the given statuses, newest activity first. */
export async function listApplications(
  statuses: readonly ApplicationStatus[],
): Promise<ApplicationListItem[]> {
  return sql<ApplicationListItem[]>`
    select
      j.id,
      j.title,
      j.url,
      j.location_raw,
      j.is_remote,
      j.season,
      j.posted_at,
      j.discovered_at,
      j.source_kind,
      j.is_ignored,
      c.id         as company_id,
      c.name       as company_name,
      c.category   as company_category,
      c.preference as company_preference,
      s.total      as score,
      s.summary    as score_summary,
      (coalesce(j.posted_at, j.discovered_at) > now() - interval '3 days')
                   as is_fresh,
      j.pay_raw    as pay_label,
      j.pay_monthly_max as pay_monthly_max,
      coalesce(s.strongest_skills, '{}')     as strongest_skills,
      coalesce(s.missing_requirements, '{}') as missing_requirements,
      0            as duplicate_count,
      a.id         as application_id,
      a.status     as application_status,
      a.priority,
      a.applied_at,
      a.updated_at,
      a.next_action,
      a.next_action_at,
      (a.resume_version_id is not null) as has_resume,
      (
        select count(*)::int from outreach_messages o
        where o.application_id = a.id and o.status = 'sent'
      )            as outreach_count
    from applications a
    join jobs j      on j.id = a.job_id
    join companies c on c.id = j.company_id
    left join lateral (
      select js.total, js.summary, js.strongest_skills, js.missing_requirements
      from job_scores js
      where js.job_id = j.id
      order by js.created_at desc
      limit 1
    ) s on true
    where a.status = any(${statuses as unknown as string[]}::application_status[])
    order by a.priority desc, a.updated_at desc
  `;
}

/** Counts by status, for the dashboard and nav badges. */
export async function statusCounts(): Promise<Record<ApplicationStatus, number>> {
  const rows = await sql<{ status: ApplicationStatus; count: string }[]>`
    select status, count(*)::text as count
    from applications
    group by status
  `;
  const counts = {} as Record<ApplicationStatus, number>;
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}
