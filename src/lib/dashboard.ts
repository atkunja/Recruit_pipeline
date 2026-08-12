import "server-only";
import { sql } from "./db";

/**
 * The morning summary.
 *
 * One round trip: every number on the Today page comes from this query, so
 * opening the dashboard is a single database call rather than a dozen.
 */

export interface DashboardSummary {
  newJobsToday: number;
  highFitToday: number;
  readyForReview: number;
  contactsIdentified: number;
  recruiterResponses: number;
  actionRequired: number;
  applicationsThisWeek: number;
  outreachThisWeek: number;
  openTasks: number;
  /** Best unprepared opportunities, for "Prepare Today's Best". */
  topCandidates: {
    jobId: number;
    title: string;
    companyName: string;
    score: number;
  }[];
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const [counts, top] = await Promise.all([
    sql<
      {
        newJobsToday: string;
        highFitToday: string;
        readyForReview: string;
        contactsIdentified: string;
        recruiterResponses: string;
        actionRequired: string;
        applicationsThisWeek: string;
        outreachThisWeek: string;
        openTasks: string;
      }[]
    >`
      select
        (
          select count(*) from jobs
          where discovered_at >= date_trunc('day', now())
            and canonical_job_id is null
            and not is_ignored
            and is_active
        )::text as "newJobsToday",
        (
          select count(*) from jobs j
          join lateral (
            select total from job_scores s
            where s.job_id = j.id order by s.created_at desc limit 1
          ) s on true
          where j.discovered_at >= date_trunc('day', now())
            and j.canonical_job_id is null
            and not j.is_ignored
            and j.is_active
            and s.total >= 90
        )::text as "highFitToday",
        (
          select count(*) from applications
          where status in ('preparing', 'ready_to_apply')
        )::text as "readyForReview",
        (
          select count(*) from contacts
          where status = 'identified'
        )::text as "contactsIdentified",
        (
          select count(*) from email_threads
          where classification = 'recruiter_reply'
            and reviewed_at is null
        )::text as "recruiterResponses",
        (
          select count(*) from applications
          where status = 'oa'
        )::text as "actionRequired",
        (
          select count(*) from applications
          where applied_at >= now() - interval '7 days'
        )::text as "applicationsThisWeek",
        (
          select count(*) from outreach_messages
          where sent_at >= now() - interval '7 days'
        )::text as "outreachThisWeek",
        (
          select count(*) from tasks where status = 'open'
        )::text as "openTasks"
    `,
    sql<
      { jobId: number; title: string; companyName: string; score: number }[]
    >`
      select j.id as job_id, j.title, c.name as company_name, s.total as score
      from jobs j
      join companies c on c.id = j.company_id
      join lateral (
        select total from job_scores js
        where js.job_id = j.id order by js.created_at desc limit 1
      ) s on true
      left join applications a on a.job_id = j.id
      where j.is_active
        and not j.is_ignored
        and j.canonical_job_id is null
        and a.id is null
      order by s.total desc, j.discovered_at desc
      limit 10
    `,
  ]);

  const row = counts[0];
  const num = (value: string | undefined) => Number(value ?? 0);

  return {
    newJobsToday: num(row?.newJobsToday),
    highFitToday: num(row?.highFitToday),
    readyForReview: num(row?.readyForReview),
    contactsIdentified: num(row?.contactsIdentified),
    recruiterResponses: num(row?.recruiterResponses),
    actionRequired: num(row?.actionRequired),
    applicationsThisWeek: num(row?.applicationsThisWeek),
    outreachThisWeek: num(row?.outreachThisWeek),
    openTasks: num(row?.openTasks),
    topCandidates: top,
  };
}

/** "Good morning" / "Good afternoon" / "Good evening". */
export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
