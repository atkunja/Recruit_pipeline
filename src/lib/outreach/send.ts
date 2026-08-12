import "server-only";
import { sql } from "../db";
import { sendEmail } from "../gmail/send";
import { recordContactAttempt } from "../contacts/repository";
import { setStatus } from "../applications/repository";
import { logActivity } from "../activity";
import { isAutoSendEnabled } from "../settings";
import type { OutreachMessage } from "../types";

/**
 * Sending an approved outreach message.
 *
 * Approval is a precondition checked here, not only in the UI: a draft that was
 * never approved cannot be sent even if something calls this directly. The
 * auto-send flag exists so the capability can be turned on deliberately later,
 * and it defaults to false.
 */

export class NotApprovedError extends Error {
  constructor() {
    super("This message has not been approved. Approve it before sending.");
    this.name = "NotApprovedError";
  }
}

export async function approveOutreach(id: number): Promise<OutreachMessage> {
  const rows = await sql<OutreachMessage[]>`
    update outreach_messages
    set status = 'approved', approved_at = now(), updated_at = now()
    where id = ${id} and status = 'draft'
    returning *
  `;
  const message = rows[0];
  if (!message) {
    throw new Error("Message not found, or it is not a draft any more.");
  }
  return message;
}

export async function sendOutreach(id: number): Promise<OutreachMessage> {
  const rows = await sql<OutreachMessage[]>`
    select * from outreach_messages where id = ${id}
  `;
  const message = rows[0];
  if (!message) throw new Error(`No outreach message ${id}`);

  if (message.status === "sent") {
    throw new Error("That message has already been sent.");
  }

  // The gate. Auto-send is off by default and must be turned on knowingly.
  if (message.approvedAt === null && !(await isAutoSendEnabled())) {
    throw new NotApprovedError();
  }

  const contacts = await sql<
    { id: number; name: string; email: string | null; status: string }[]
  >`select id, name, email, status from contacts where id = ${message.contactId}`;

  const contact = contacts[0];
  if (!contact) throw new Error("Contact no longer exists");
  if (contact.email === null || contact.email.length === 0) {
    throw new Error(
      `No email address on file for ${contact.name}. Add one before sending.`,
    );
  }
  if (contact.status === "do_not_contact") {
    throw new Error(`${contact.name} is marked do-not-contact.`);
  }

  // Thread a follow-up onto the original conversation.
  let threadId: string | null = null;
  if (message.inReplyToId !== null) {
    const previous = await sql<{ gmailThreadId: string | null }[]>`
      select gmail_thread_id from outreach_messages where id = ${message.inReplyToId}
    `;
    threadId = previous[0]?.gmailThreadId ?? null;
  }

  try {
    const sent = await sendEmail({
      to: contact.email,
      subject: message.subject,
      body: message.body,
      threadId,
    });

    const updated = await sql<OutreachMessage[]>`
      update outreach_messages set
        status           = 'sent',
        sent_at          = now(),
        gmail_message_id = ${sent.messageId},
        gmail_thread_id  = ${sent.threadId},
        error            = null,
        updated_at       = now()
      where id = ${id}
      returning *
    `;

    await recordContactAttempt(contact.id);

    if (message.applicationId !== null) {
      // Only move a pre-submission application forward; an application already
      // at OA or interview should not be dragged back to "outreach sent".
      const application = await sql<{ status: string }[]>`
        select status from applications where id = ${message.applicationId}
      `;
      const status = application[0]?.status;
      if (status !== undefined && ["discovered", "preparing", "ready_to_apply", "applied"].includes(status)) {
        await setStatus(
          message.applicationId,
          "outreach_sent",
          `Emailed ${contact.name}`,
        );
      }
    }

    await logActivity({
      kind: "outreach_sent",
      message: `Sent "${message.subject}" to ${contact.name}`,
      contactId: contact.id,
      applicationId: message.applicationId,
      jobId: message.jobId,
      meta: { gmailThreadId: sent.threadId },
    });

    const result = updated[0];
    if (!result) throw new Error("Send succeeded but the record could not be updated");
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await sql`
      update outreach_messages
      set status = 'failed', error = ${detail}, updated_at = now()
      where id = ${id}
    `;
    throw error;
  }
}
