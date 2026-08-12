import "server-only";
import { sql } from "../db";
import { logActivity } from "../activity";
import type { Contact, ContactCategory, ContactStatus } from "../types";

/**
 * Contact storage.
 *
 * Scope note, enforced by the schema as much as by convention: only
 * professional, publicly published details are kept — name, role, company,
 * public profile URL, work email. There is deliberately no column for a
 * personal address, personal phone, or any other private detail, so no code
 * path can persist one.
 */

export interface UpsertContactInput {
  companyId: number;
  name: string;
  title?: string | null;
  category?: ContactCategory;
  linkedinUrl?: string | null;
  email?: string | null;
  source?: string;
  relevanceReason?: string | null;
  isAlum?: boolean;
  outreachValue?: number;
  notes?: string | null;
}

export async function upsertContact(
  input: UpsertContactInput,
): Promise<Contact> {
  const rows = await sql<Contact[]>`
    insert into contacts (
      company_id, name, title, category, linkedin_url, email, source,
      relevance_reason, is_alum, outreach_value, notes
    ) values (
      ${input.companyId}, ${input.name}, ${input.title ?? null},
      ${input.category ?? "other"}, ${input.linkedinUrl ?? null},
      ${input.email ?? null}, ${input.source ?? "manual"},
      ${input.relevanceReason ?? null}, ${input.isAlum ?? false},
      ${input.outreachValue ?? defaultValue(input)}, ${input.notes ?? null}
    )
    on conflict (company_id, lower(name)) do update set
      title           = coalesce(excluded.title, contacts.title),
      category        = case
        when contacts.category = 'other' then excluded.category
        else contacts.category
      end,
      linkedin_url    = coalesce(excluded.linkedin_url, contacts.linkedin_url),
      email           = coalesce(excluded.email, contacts.email),
      relevance_reason = coalesce(excluded.relevance_reason, contacts.relevance_reason),
      is_alum         = contacts.is_alum or excluded.is_alum,
      updated_at      = now()
    returning *
  `;

  const contact = rows[0];
  if (!contact) throw new Error(`Failed to upsert contact ${input.name}`);
  return contact;
}

/**
 * Default outreach value from role and connection.
 *
 * The ordering reflects who actually replies to a student: university
 * recruiters own intern hiring and answer; a random engineer usually doesn't.
 */
function defaultValue(input: UpsertContactInput): number {
  const base: Record<ContactCategory, number> = {
    university_recruiter: 90,
    technical_recruiter: 80,
    recruiter: 70,
    hiring_manager: 65,
    engineer: 50,
    alum: 60,
    other: 40,
  };

  let value = base[input.category ?? "other"];
  if (input.isAlum === true) value = Math.min(100, value + 15);
  // A contact we can actually email outranks one we can only look at.
  if (input.email) value = Math.min(100, value + 5);
  return value;
}

export async function getContact(id: number): Promise<Contact | null> {
  const rows = await sql<Contact[]>`select * from contacts where id = ${id}`;
  return rows[0] ?? null;
}

export type ContactListItem = Contact & {
  companyName: string;
  sentCount: number;
  lastSentAt: Date | null;
};

export async function listContacts(
  filters: { companyId?: number; status?: ContactStatus } = {},
): Promise<ContactListItem[]> {
  return sql<ContactListItem[]>`
    select
      c.*,
      co.name as company_name,
      (
        select count(*)::int from outreach_messages o
        where o.contact_id = c.id and o.status = 'sent'
      ) as sent_count,
      (
        select max(o.sent_at) from outreach_messages o
        where o.contact_id = c.id and o.status = 'sent'
      ) as last_sent_at
    from contacts c
    join companies co on co.id = c.company_id
    where (${filters.companyId ?? null}::bigint is null or c.company_id = ${filters.companyId ?? null})
      and (${filters.status ?? null}::text is null or c.status::text = ${filters.status ?? null})
    order by c.outreach_value desc, c.created_at desc
  `;
}

export async function setContactStatus(
  contactId: number,
  status: ContactStatus,
): Promise<void> {
  await sql`
    update contacts set status = ${status}, updated_at = now()
    where id = ${contactId}
  `;
  await logActivity({
    kind: "contact_status_changed",
    message: `Contact marked ${status.replace(/_/g, " ")}`,
    contactId,
  });
}

/**
 * Record that we contacted someone.
 * `contact_count` and `last_contacted_at` are what the follow-up scheduler
 * reads to avoid pestering the same person.
 */
export async function recordContactAttempt(contactId: number): Promise<void> {
  await sql`
    update contacts set
      status            = case when status = 'replied' then status else 'contacted' end,
      last_contacted_at = now(),
      contact_count     = contact_count + 1,
      updated_at        = now()
    where id = ${contactId}
  `;
}

/**
 * People we have already emailed about a given job.
 * Used to make the "never email the same recruiter twice about one role" rule
 * visible in the UI, in addition to the unique index that enforces it.
 */
export async function contactedForJob(jobId: number): Promise<Set<number>> {
  const rows = await sql<{ contactId: number }[]>`
    select distinct contact_id from outreach_messages
    where job_id = ${jobId} and status = 'sent'
  `;
  return new Set(rows.map((row) => row.contactId));
}
