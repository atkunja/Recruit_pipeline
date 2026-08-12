import "server-only";
import { json, sql } from "./db";
import type { ActivityEvent } from "./types";

/**
 * The append-only event log behind every CRM timeline.
 *
 * Writes never throw: an activity row failing to insert must not roll back the
 * real work that produced it.
 */

export interface LogActivityInput {
  kind: string;
  message: string;
  jobId?: number | null;
  applicationId?: number | null;
  contactId?: number | null;
  companyId?: number | null;
  meta?: Record<string, unknown>;
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await sql`
      insert into activity_events (
        kind, message, job_id, application_id, contact_id, company_id, meta
      ) values (
        ${input.kind}, ${input.message}, ${input.jobId ?? null},
        ${input.applicationId ?? null}, ${input.contactId ?? null},
        ${input.companyId ?? null}, ${sql.json(json(input.meta ?? {}))}
      )
    `;
  } catch (error) {
    console.error("Failed to log activity", input.kind, error);
  }
}

/** Full timeline for one application, oldest first. */
export async function getApplicationTimeline(
  applicationId: number,
): Promise<ActivityEvent[]> {
  return sql<ActivityEvent[]>`
    select * from activity_events
    where application_id = ${applicationId}
       or job_id = (select job_id from applications where id = ${applicationId})
    order by at asc
  `;
}

/** Recent activity across everything, for the dashboard feed. */
export async function getRecentActivity(limit = 30): Promise<ActivityEvent[]> {
  return sql<ActivityEvent[]>`
    select * from activity_events
    order by at desc
    limit ${limit}
  `;
}
