import "server-only";
import { sql } from "../db";
import { gmailFetch } from "./client";
import { classifyEmails } from "./classify";
import { logActivity } from "../activity";
import { setStatus } from "../applications/repository";
import type { ApplicationStatus, EmailClassification } from "../types";

/**
 * Pull recruiting mail and reconcile it with applications.
 *
 * Only metadata and a snippet are stored — never message bodies. That keeps
 * the database small and limits what a compromise of it would expose.
 *
 * Matching an email to an application is done by, in order of confidence:
 *   1. the Gmail thread of an outreach message we sent
 *   2. the sender's domain against a company we have applied to
 *   3. the company name appearing in the subject
 */

interface GmailMessageMeta {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: {
    headers?: { name?: string; value?: string }[];
  };
}

export interface SyncResult {
  scanned: number;
  stored: number;
  classified: number;
  statusUpdates: number;
  needsReview: number;
}

/** How far back to look on a routine sync. */
const DEFAULT_WINDOW_DAYS = 21;

export async function syncGmail(
  options: { windowDays?: number; maxMessages?: number } = {},
): Promise<SyncResult> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const maxMessages = options.maxMessages ?? 60;

  const result: SyncResult = {
    scanned: 0,
    stored: 0,
    classified: 0,
    statusUpdates: 0,
    needsReview: 0,
  };

  // Restrict the query server-side; pulling the whole inbox would be slow and
  // would read mail that has nothing to do with recruiting.
  const query = [
    `newer_than:${windowDays}d`,
    "-in:chats",
    "-category:promotions",
    "-category:social",
  ].join(" ");

  const list = await gmailFetch<{
    messages?: { id: string; threadId: string }[];
  }>(`/messages?q=${encodeURIComponent(query)}&maxResults=${maxMessages}`);

  const ids = (list.messages ?? []).map((message) => message.id);
  result.scanned = ids.length;
  if (ids.length === 0) return result;

  const known = await knownMessageIds(ids);
  const fresh = ids.filter((id) => !known.has(id));

  const pending: {
    meta: GmailMessageMeta;
    from: string;
    fromName: string;
    subject: string;
    snippet: string;
    receivedAt: Date;
  }[] = [];

  for (const id of fresh) {
    const meta = await gmailFetch<GmailMessageMeta>(
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To`,
    );

    const headers = new Map(
      (meta.payload?.headers ?? []).map((header) => [
        (header.name ?? "").toLowerCase(),
        header.value ?? "",
      ]),
    );

    const rawFrom = headers.get("from") ?? "";
    pending.push({
      meta,
      from: extractEmail(rawFrom),
      fromName: extractName(rawFrom),
      subject: headers.get("subject") ?? "",
      snippet: meta.snippet ?? "",
      receivedAt: meta.internalDate
        ? new Date(Number(meta.internalDate))
        : new Date(),
    });
  }

  if (pending.length === 0) return result;

  // Classify in one batched call rather than one per message.
  const classifications = await classifyEmails(
    pending.map((item) => ({
      id: item.meta.id,
      from: item.from,
      subject: item.subject,
      snippet: item.snippet,
    })),
  );
  result.classified = classifications.length;

  const byId = new Map(classifications.map((item) => [item.id, item]));

  for (const item of pending) {
    const classification = byId.get(item.meta.id);
    const kind: EmailClassification = classification?.classification ?? "unknown";
    const confidence = classification?.confidence ?? 0;

    // Nothing recruiting-related: don't store it at all.
    if (kind === "other" || kind === "unknown") continue;

    const match = await matchToApplication(
      item.meta.threadId,
      item.from,
      item.subject,
    );

    const threadRows = await sql<{ id: number }[]>`
      insert into email_threads (
        gmail_thread_id, application_id, contact_id, company_id, subject,
        snippet, last_message_at, last_from, message_count, classification,
        confidence, needs_review
      ) values (
        ${item.meta.threadId}, ${match.applicationId}, ${match.contactId},
        ${match.companyId}, ${item.subject}, ${item.snippet}, ${item.receivedAt},
        ${item.from}, 1, ${kind}, ${confidence},
        ${confidence < 0.75 || match.applicationId === null}
      )
      on conflict (gmail_thread_id) do update set
        last_message_at = greatest(email_threads.last_message_at, excluded.last_message_at),
        last_from       = excluded.last_from,
        snippet         = excluded.snippet,
        message_count   = email_threads.message_count + 1,
        classification  = excluded.classification,
        confidence      = excluded.confidence,
        application_id  = coalesce(email_threads.application_id, excluded.application_id),
        needs_review    = excluded.needs_review,
        updated_at      = now()
      returning id
    `;

    const threadId = threadRows[0]?.id;
    if (threadId === undefined) continue;

    await sql`
      insert into email_messages (
        thread_id, gmail_message_id, direction, from_email, from_name,
        subject, snippet, received_at, classification, confidence
      ) values (
        ${threadId}, ${item.meta.id}, 'inbound', ${item.from}, ${item.fromName},
        ${item.subject}, ${item.snippet}, ${item.receivedAt}, ${kind}, ${confidence}
      )
      on conflict (gmail_message_id) do nothing
    `;
    result.stored += 1;

    if (confidence < 0.75 || match.applicationId === null) {
      result.needsReview += 1;
      continue;
    }

    // Confident and matched: advance the application automatically.
    const nextStatus = statusFor(kind);
    if (nextStatus !== null && match.applicationId !== null) {
      await setStatus(
        match.applicationId,
        nextStatus,
        `${describe(kind)} from ${item.fromName || item.from}`,
      );
      result.statusUpdates += 1;

      if (kind === "oa_invite" || kind === "interview_invite") {
        await sql`
          insert into interviews (application_id, kind, status, notes)
          values (
            ${match.applicationId},
            ${kind === "oa_invite" ? "oa" : "phone_screen"},
            'scheduled',
            ${`Detected from email: ${item.subject}`}
          )
        `;
      }
    }

    if (match.contactId !== null) {
      await sql`
        update contacts set status = 'replied', updated_at = now()
        where id = ${match.contactId} and status <> 'do_not_contact'
      `;
    }

    await logActivity({
      kind: "email_received",
      message: `${describe(kind)}: ${item.subject}`,
      applicationId: match.applicationId,
      contactId: match.contactId,
      companyId: match.companyId,
      meta: { classification: kind, confidence },
    });
  }

  return result;
}

/** Statuses an email can move an application into on its own. */
function statusFor(kind: EmailClassification): ApplicationStatus | null {
  switch (kind) {
    case "oa_invite":
      return "oa";
    case "interview_invite":
      return "interview";
    case "rejection":
      return "rejected";
    default:
      // A plain reply is signal, but not a stage change.
      return null;
  }
}

function describe(kind: EmailClassification): string {
  switch (kind) {
    case "recruiter_reply":
      return "Recruiter replied";
    case "interview_invite":
      return "Interview invitation";
    case "oa_invite":
      return "Online assessment invitation";
    case "rejection":
      return "Rejection";
    case "follow_up":
      return "Follow-up";
    case "auto_ack":
      return "Application acknowledgement";
    default:
      return "Email";
  }
}

interface Match {
  applicationId: number | null;
  contactId: number | null;
  companyId: number | null;
}

async function matchToApplication(
  gmailThreadId: string,
  fromEmail: string,
  subject: string,
): Promise<Match> {
  // 1. A thread we started — the strongest possible link.
  const viaOutreach = await sql<
    { applicationId: number | null; contactId: number; companyId: number }[]
  >`
    select o.application_id, o.contact_id, c.company_id
    from outreach_messages o
    join contacts c on c.id = o.contact_id
    where o.gmail_thread_id = ${gmailThreadId}
    limit 1
  `;
  if (viaOutreach[0]) {
    return {
      applicationId: viaOutreach[0].applicationId,
      contactId: viaOutreach[0].contactId,
      companyId: viaOutreach[0].companyId,
    };
  }

  // 2. A known contact's address.
  const viaContact = await sql<{ id: number; companyId: number }[]>`
    select id, company_id from contacts where lower(email) = ${fromEmail.toLowerCase()}
    limit 1
  `;
  if (viaContact[0]) {
    const application = await latestApplicationForCompany(viaContact[0].companyId);
    return {
      applicationId: application,
      contactId: viaContact[0].id,
      companyId: viaContact[0].companyId,
    };
  }

  // 3. The sender's domain, matched against companies we have applied to.
  const domain = fromEmail.split("@")[1] ?? "";
  if (domain.length > 0) {
    const label = domain.split(".")[0] ?? "";
    const viaDomain = await sql<{ id: number }[]>`
      select c.id
      from companies c
      where exists (
        select 1 from jobs j
        join applications a on a.job_id = j.id
        where j.company_id = c.id
      )
      and (
        c.website ilike ${"%" + domain + "%"}
        or c.slug = ${label}
        or ${subject} ilike '%' || c.name || '%'
      )
      limit 1
    `;
    if (viaDomain[0]) {
      return {
        applicationId: await latestApplicationForCompany(viaDomain[0].id),
        contactId: null,
        companyId: viaDomain[0].id,
      };
    }
  }

  return { applicationId: null, contactId: null, companyId: null };
}

async function latestApplicationForCompany(
  companyId: number,
): Promise<number | null> {
  const rows = await sql<{ id: number }[]>`
    select a.id
    from applications a
    join jobs j on j.id = a.job_id
    where j.company_id = ${companyId}
      and a.status not in ('rejected', 'withdrawn')
    order by a.updated_at desc
    limit 1
  `;
  return rows[0]?.id ?? null;
}

async function knownMessageIds(ids: string[]): Promise<Set<string>> {
  const rows = await sql<{ gmailMessageId: string }[]>`
    select gmail_message_id from email_messages where gmail_message_id = any(${ids})
  `;
  return new Set(rows.map((row) => row.gmailMessageId));
}

export function extractEmail(header: string): string {
  const angled = /<([^>]+)>/.exec(header);
  if (angled?.[1] !== undefined) return angled[1].trim().toLowerCase();
  return header.trim().toLowerCase();
}

export function extractName(header: string): string {
  const named = /^\s*"?([^"<]+?)"?\s*</.exec(header);
  return named?.[1]?.trim() ?? "";
}
