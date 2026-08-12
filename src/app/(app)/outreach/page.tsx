import { sql } from "@/lib/db";
import { gmailStatus } from "@/lib/gmail/client";
import { listContacts } from "@/lib/contacts/repository";
import { findFollowUpCandidates } from "@/lib/outreach/follow-ups";
import { EmptyState, PageHeader, Panel, Stat, Tag, relativeTime } from "@/components/ui";
import { OutreachDraft } from "./draft-card";
import { GmailBanner } from "./gmail-banner";
import type { OutreachMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

type DraftRow = OutreachMessage & {
  contactName: string;
  contactEmail: string | null;
  companyName: string;
  jobTitle: string | null;
};

export default async function OutreachPage() {
  const [status, drafts, sent, contacts, followUps, threads] = await Promise.all([
    gmailStatus(),
    sql<DraftRow[]>`
      select o.*, c.name as contact_name, c.email as contact_email,
             co.name as company_name, j.title as job_title
      from outreach_messages o
      join contacts c   on c.id = o.contact_id
      join companies co on co.id = c.company_id
      left join jobs j  on j.id = o.job_id
      where o.status in ('draft', 'approved', 'failed')
      order by o.created_at desc
    `,
    sql<DraftRow[]>`
      select o.*, c.name as contact_name, c.email as contact_email,
             co.name as company_name, j.title as job_title
      from outreach_messages o
      join contacts c   on c.id = o.contact_id
      join companies co on co.id = c.company_id
      left join jobs j  on j.id = o.job_id
      where o.status = 'sent'
      order by o.sent_at desc
      limit 40
    `,
    listContacts(),
    findFollowUpCandidates(),
    sql<
      {
        id: number;
        subject: string | null;
        snippet: string | null;
        classification: string;
        lastMessageAt: Date | null;
        needsReview: boolean;
        lastFrom: string | null;
      }[]
    >`
      select id, subject, snippet, classification, last_message_at, needs_review, last_from
      from email_threads
      order by last_message_at desc nulls last
      limit 20
    `,
  ]);

  const replied = contacts.filter((contact) => contact.status === "replied").length;
  const contacted = contacts.filter((contact) => contact.sentCount > 0).length;
  const responseRate =
    contacted === 0 ? null : Math.round((replied / contacted) * 100);

  return (
    <>
      <PageHeader
        title="Outreach"
        subtitle={`${drafts.length} awaiting your approval · ${sent.length} sent · ${contacts.length} contacts`}
      />

      <GmailBanner status={status} />

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Drafts" value={drafts.length} />
        <Stat label="Sent" value={sent.length} />
        <Stat label="Replied" value={replied} tone={replied > 0 ? "good" : "default"} />
        <Stat
          label="Response rate"
          value={responseRate === null ? "—" : `${responseRate}%`}
          hint={contacted === 0 ? "no sends yet" : `of ${contacted} contacted`}
        />
        <Stat
          label="Follow-ups due"
          value={followUps.length}
          tone={followUps.length > 0 ? "warn" : "default"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-5">
          <section>
            <h2 className="eyebrow mb-2">Awaiting approval</h2>
            {drafts.length === 0 ? (
              <EmptyState
                title="No drafts"
                hint="Prepare a job and add a contact, then generate outreach from the job page. Nothing is ever sent without you approving it here."
              />
            ) : (
              <div className="flex flex-col gap-2">
                {drafts.map((draft) => (
                  <OutreachDraft
                    key={draft.id}
                    draft={{
                      id: draft.id,
                      subject: draft.subject,
                      body: draft.body,
                      status: draft.status,
                      kind: draft.kind,
                      error: draft.error,
                      contactName: draft.contactName,
                      contactEmail: draft.contactEmail,
                      companyName: draft.companyName,
                      jobTitle: draft.jobTitle,
                      approvedAt: draft.approvedAt === null ? null : String(draft.approvedAt),
                    }}
                    canSend={status.connected && status.canSend}
                  />
                ))}
              </div>
            )}
          </section>

          {sent.length > 0 && (
            <section>
              <h2 className="eyebrow mb-2">Sent</h2>
              <Panel className="divide-y divide-border">
                {sent.map((message) => (
                  <div key={message.id} className="px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{message.contactName}</span>
                      <span className="text-muted">{message.companyName}</span>
                      {message.kind === "follow_up" && <Tag>follow-up</Tag>}
                      <span className="ml-auto shrink-0 text-[11px] text-faint">
                        {relativeTime(message.sentAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-faint">
                      {message.subject}
                    </p>
                  </div>
                ))}
              </Panel>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-5">
          <section>
            <h2 className="eyebrow mb-2">Recent recruiting mail</h2>
            {threads.length === 0 ? (
              <Panel className="px-3 py-6 text-center text-faint">
                {status.connected
                  ? "Nothing detected yet."
                  : "Connect Gmail to track replies."}
              </Panel>
            ) : (
              <Panel className="divide-y divide-border">
                {threads.map((thread) => (
                  <div key={thread.id} className="px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <Tag
                        tone={
                          thread.classification === "rejection" ? "danger" : "default"
                        }
                      >
                        {thread.classification.replace(/_/g, " ")}
                      </Tag>
                      {thread.needsReview && <Tag tone="muted">needs review</Tag>}
                      <span className="ml-auto shrink-0 text-[11px] text-faint">
                        {relativeTime(thread.lastMessageAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate">{thread.subject ?? "(no subject)"}</p>
                    <p className="truncate text-[11px] text-faint">{thread.lastFrom}</p>
                  </div>
                ))}
              </Panel>
            )}
          </section>

          <section>
            <h2 className="eyebrow mb-2">Contacts</h2>
            {contacts.length === 0 ? (
              <Panel className="px-3 py-6 text-center text-faint">
                No contacts yet. Add them from a job page.
              </Panel>
            ) : (
              <Panel className="max-h-96 divide-y divide-border overflow-auto">
                {contacts.map((contact) => (
                  <div key={contact.id} className="px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-accent">
                        {contact.outreachValue}
                      </span>
                      <span className="truncate font-medium">{contact.name}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-faint">
                        {contact.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="ml-9 truncate text-[11px] text-faint">
                      {contact.title ?? contact.category.replace(/_/g, " ")} ·{" "}
                      {contact.companyName}
                      {contact.email === null && " · no email"}
                    </p>
                  </div>
                ))}
              </Panel>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
