import "server-only";
import { sql } from "../db";
import { generateOutreach } from "./generate";
import { logActivity } from "../activity";

/**
 * Follow-up scheduling.
 *
 * The guard rails matter more than the scheduling here. A follow-up is only
 * proposed when all of these hold:
 *
 *   - the original was sent at least `FOLLOW_UP_AFTER_DAYS` ago
 *   - they never replied
 *   - we have followed up at most `MAX_FOLLOW_UPS` times already
 *   - the contact is not marked do-not-contact
 *   - the application is still live (not rejected or withdrawn)
 *   - there is no open follow-up task for them already
 *
 * And even then it produces a *draft* plus a task. Nothing sends itself.
 */

const FOLLOW_UP_AFTER_DAYS = 5;
const MAX_FOLLOW_UPS = 1;

export interface FollowUpCandidate {
  contactId: number;
  contactName: string;
  companyName: string;
  jobId: number;
  jobTitle: string;
  applicationId: number | null;
  originalId: number;
  sentAt: Date;
  daysSince: number;
}

export async function findFollowUpCandidates(): Promise<FollowUpCandidate[]> {
  return sql<FollowUpCandidate[]>`
    select
      c.id            as contact_id,
      c.name          as contact_name,
      co.name         as company_name,
      o.job_id,
      j.title         as job_title,
      o.application_id,
      o.id            as original_id,
      o.sent_at,
      extract(day from now() - o.sent_at)::int as days_since
    from outreach_messages o
    join contacts c   on c.id = o.contact_id
    join companies co on co.id = c.company_id
    join jobs j       on j.id = o.job_id
    left join applications a on a.id = o.application_id
    where o.kind = 'initial'
      and o.status = 'sent'
      and o.sent_at < now() - ${`${FOLLOW_UP_AFTER_DAYS} days`}::interval

      -- They never wrote back.
      and c.status <> 'replied'
      and c.status <> 'do_not_contact'
      and c.status <> 'bounced'

      -- We haven't already chased them.
      and (
        select count(*) from outreach_messages f
        where f.contact_id = c.id
          and f.job_id = o.job_id
          and f.kind = 'follow_up'
          and f.status in ('sent', 'draft', 'approved')
      ) < ${MAX_FOLLOW_UPS}

      -- The opportunity is still alive.
      and (a.id is null or a.status not in ('rejected', 'withdrawn', 'offer'))

      -- Nothing already queued for this person.
      and not exists (
        select 1 from tasks t
        where t.kind = 'follow_up'
          and t.contact_id = c.id
          and t.status = 'open'
      )
    order by o.sent_at asc
    limit 25
  `;
}

export interface FollowUpRunResult {
  candidates: number;
  drafted: number;
  failed: number;
}

/**
 * Draft follow-ups and queue them for review.
 * `limit` bounds model spend on a scheduled run.
 */
export async function runFollowUps(limit = 10): Promise<FollowUpRunResult> {
  const candidates = await findFollowUpCandidates();
  const batch = candidates.slice(0, limit);

  const result: FollowUpRunResult = {
    candidates: candidates.length,
    drafted: 0,
    failed: 0,
  };

  for (const candidate of batch) {
    try {
      const draft = await generateOutreach({
        contactId: candidate.contactId,
        jobId: candidate.jobId,
        applicationId: candidate.applicationId,
        kind: "follow_up",
      });

      await sql`
        update outreach_messages
        set in_reply_to_id = ${candidate.originalId}
        where id = ${draft.id}
      `;

      await sql`
        insert into tasks (kind, title, detail, application_id, contact_id, job_id, due_at)
        values (
          'follow_up',
          ${`Follow up with ${candidate.contactName} at ${candidate.companyName}`},
          ${`No reply after ${candidate.daysSince} days. A follow-up is drafted and waiting for your approval.`},
          ${candidate.applicationId}, ${candidate.contactId}, ${candidate.jobId},
          now()
        )
        on conflict do nothing
      `;

      await logActivity({
        kind: "follow_up_drafted",
        message: `Follow-up drafted for ${candidate.contactName} (${candidate.daysSince} days, no reply)`,
        contactId: candidate.contactId,
        applicationId: candidate.applicationId,
        jobId: candidate.jobId,
      });

      result.drafted += 1;
    } catch (error) {
      result.failed += 1;
      console.error(
        `[follow-ups] failed for contact ${candidate.contactId}`,
        error,
      );
    }
  }

  return result;
}
