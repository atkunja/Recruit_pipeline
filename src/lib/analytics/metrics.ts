import "server-only";
import { sql } from "../db";

/**
 * Recruiting funnel metrics.
 *
 * Rates are computed against the right denominator, which is the whole point:
 * an "interview rate" over every job ever discovered is meaningless, so it is
 * measured against applications submitted.
 */

export interface FunnelMetrics {
  jobsDiscovered: number;
  highFitDiscovered: number;
  jobsScored: number;
  applicationsSubmitted: number;
  outreachSent: number;
  contactsIdentified: number;
  repliesReceived: number;
  oaReceived: number;
  interviewsReached: number;
  offersReceived: number;
  rejections: number;

  /** Percentages, or null when the denominator is too small to mean anything. */
  responseRate: number | null;
  oaRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
}

/** Below this, a percentage is noise rather than a signal. */
const MIN_SAMPLE = 5;

function rate(numerator: number, denominator: number): number | null {
  if (denominator < MIN_SAMPLE) return null;
  return Math.round((numerator / denominator) * 100);
}

export async function getFunnelMetrics(): Promise<FunnelMetrics> {
  const rows = await sql<
    {
      jobsDiscovered: string;
      highFitDiscovered: string;
      jobsScored: string;
      applicationsSubmitted: string;
      outreachSent: string;
      contactsIdentified: string;
      repliesReceived: string;
      oaReceived: string;
      interviewsReached: string;
      offersReceived: string;
      rejections: string;
    }[]
  >`
    select
      (select count(*) from jobs where canonical_job_id is null)::text as "jobsDiscovered",
      (
        select count(*) from jobs j
        join lateral (
          select total from job_scores s where s.job_id = j.id
          order by s.created_at desc limit 1
        ) s on true
        where j.canonical_job_id is null and s.total >= 85
      )::text as "highFitDiscovered",
      (select count(distinct job_id) from job_scores)::text as "jobsScored",
      (select count(*) from applications where applied_at is not null)::text as "applicationsSubmitted",
      (select count(*) from outreach_messages where status = 'sent')::text as "outreachSent",
      (select count(*) from contacts)::text as "contactsIdentified",
      (select count(*) from contacts where status = 'replied')::text as "repliesReceived",
      -- Statuses are a point-in-time snapshot, so stage counts come from the
      -- activity log: an application now at "interview" still passed through OA.
      (
        select count(distinct application_id) from activity_events
        where kind = 'status_changed' and meta->>'status' = 'oa'
      )::text as "oaReceived",
      (
        select count(distinct application_id) from activity_events
        where kind = 'status_changed' and meta->>'status' in ('interview', 'offer')
      )::text as "interviewsReached",
      (select count(*) from applications where status = 'offer')::text as "offersReceived",
      (select count(*) from applications where status = 'rejected')::text as "rejections"
  `;

  const row = rows[0];
  const n = (value: string | undefined) => Number(value ?? 0);

  const submitted = n(row?.applicationsSubmitted);
  const sent = n(row?.outreachSent);

  return {
    jobsDiscovered: n(row?.jobsDiscovered),
    highFitDiscovered: n(row?.highFitDiscovered),
    jobsScored: n(row?.jobsScored),
    applicationsSubmitted: submitted,
    outreachSent: sent,
    contactsIdentified: n(row?.contactsIdentified),
    repliesReceived: n(row?.repliesReceived),
    oaReceived: n(row?.oaReceived),
    interviewsReached: n(row?.interviewsReached),
    offersReceived: n(row?.offersReceived),
    rejections: n(row?.rejections),

    responseRate: rate(n(row?.repliesReceived), sent),
    oaRate: rate(n(row?.oaReceived), submitted),
    interviewRate: rate(n(row?.interviewsReached), submitted),
    offerRate: rate(n(row?.offersReceived), submitted),
  };
}

export interface Breakdown {
  label: string;
  applications: number;
  responses: number;
  oas: number;
  interviews: number;
  /** null when the sample is too small. */
  oaRate: number | null;
}

/** Outcomes grouped by company category. */
export async function breakdownByCompanyCategory(): Promise<Breakdown[]> {
  const rows = await sql<
    {
      label: string;
      applications: string;
      responses: string;
      oas: string;
      interviews: string;
    }[]
  >`
    select
      c.category::text as label,
      count(*) filter (where a.applied_at is not null)::text as applications,
      count(*) filter (where a.status in ('oa','interview','offer'))::text as responses,
      count(*) filter (where a.status = 'oa')::text as oas,
      count(*) filter (where a.status in ('interview','offer'))::text as interviews
    from applications a
    join jobs j      on j.id = a.job_id
    join companies c on c.id = j.company_id
    group by c.category
    having count(*) filter (where a.applied_at is not null) > 0
    order by count(*) desc
  `;
  return rows.map(toBreakdown);
}

/** Outcomes grouped by the fit score band the job was in. */
export async function breakdownByScoreBand(): Promise<Breakdown[]> {
  const rows = await sql<
    {
      label: string;
      applications: string;
      responses: string;
      oas: string;
      interviews: string;
    }[]
  >`
    select
      case
        when s.total >= 90 then '90-100'
        when s.total >= 80 then '80-89'
        when s.total >= 70 then '70-79'
        else 'under 70'
      end as label,
      count(*) filter (where a.applied_at is not null)::text as applications,
      count(*) filter (where a.status in ('oa','interview','offer'))::text as responses,
      count(*) filter (where a.status = 'oa')::text as oas,
      count(*) filter (where a.status in ('interview','offer'))::text as interviews
    from applications a
    join jobs j on j.id = a.job_id
    join lateral (
      select total from job_scores js where js.job_id = j.id
      order by js.created_at desc limit 1
    ) s on true
    where a.applied_at is not null
    group by 1
    order by 1 desc
  `;
  return rows.map(toBreakdown);
}

/** Did sending outreach change the outcome? */
export async function breakdownByOutreach(): Promise<Breakdown[]> {
  const rows = await sql<
    {
      label: string;
      applications: string;
      responses: string;
      oas: string;
      interviews: string;
    }[]
  >`
    select
      case when o.sent > 0 then 'with outreach' else 'no outreach' end as label,
      count(*)::text as applications,
      count(*) filter (where a.status in ('oa','interview','offer'))::text as responses,
      count(*) filter (where a.status = 'oa')::text as oas,
      count(*) filter (where a.status in ('interview','offer'))::text as interviews
    from applications a
    left join lateral (
      select count(*)::int as sent from outreach_messages m
      where m.application_id = a.id and m.status = 'sent'
    ) o on true
    where a.applied_at is not null
    group by 1
  `;
  return rows.map(toBreakdown);
}

/**
 * Did applying quickly matter?
 * Buckets by the gap between discovering a job and submitting.
 */
export async function breakdownByApplicationSpeed(): Promise<Breakdown[]> {
  const rows = await sql<
    {
      label: string;
      applications: string;
      responses: string;
      oas: string;
      interviews: string;
    }[]
  >`
    select
      case
        when a.applied_at - j.discovered_at < interval '2 days' then 'within 48h'
        when a.applied_at - j.discovered_at < interval '7 days' then '2-7 days'
        else 'over a week'
      end as label,
      count(*)::text as applications,
      count(*) filter (where a.status in ('oa','interview','offer'))::text as responses,
      count(*) filter (where a.status = 'oa')::text as oas,
      count(*) filter (where a.status in ('interview','offer'))::text as interviews
    from applications a
    join jobs j on j.id = a.job_id
    where a.applied_at is not null
    group by 1
  `;
  return rows.map(toBreakdown);
}

function toBreakdown(row: {
  label: string;
  applications: string;
  responses: string;
  oas: string;
  interviews: string;
}): Breakdown {
  const applications = Number(row.applications);
  const oas = Number(row.oas);
  return {
    label: row.label,
    applications,
    responses: Number(row.responses),
    oas,
    interviews: Number(row.interviews),
    oaRate: rate(oas, applications),
  };
}

/** Applications submitted per week, for the activity chart. */
export async function weeklyActivity(): Promise<
  { week: string; discovered: number; applied: number; outreach: number }[]
> {
  return sql<
    { week: string; discovered: number; applied: number; outreach: number }[]
  >`
    with weeks as (
      select generate_series(
        date_trunc('week', now()) - interval '11 weeks',
        date_trunc('week', now()),
        interval '1 week'
      ) as week
    )
    select
      to_char(w.week, 'Mon DD') as week,
      (
        select count(*)::int from jobs j
        where date_trunc('week', j.discovered_at) = w.week
          and j.canonical_job_id is null
      ) as discovered,
      (
        select count(*)::int from applications a
        where date_trunc('week', a.applied_at) = w.week
      ) as applied,
      (
        select count(*)::int from outreach_messages o
        where date_trunc('week', o.sent_at) = w.week and o.status = 'sent'
      ) as outreach
    from weeks w
    order by w.week asc
  `;
}

/** Month-to-date AI spend broken down by what it was spent on. */
export async function spendByPurpose(): Promise<
  { purpose: string; cost: number; calls: number }[]
> {
  const rows = await sql<{ purpose: string; cost: string; calls: string }[]>`
    select purpose, sum(cost_usd)::text as cost, count(*)::text as calls
    from ai_usage
    where at >= date_trunc('month', now()) and ok
    group by purpose
    order by sum(cost_usd) desc
  `;
  return rows.map((row) => ({
    purpose: row.purpose,
    cost: Number(row.cost),
    calls: Number(row.calls),
  }));
}
