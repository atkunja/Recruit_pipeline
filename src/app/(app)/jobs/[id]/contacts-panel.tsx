"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Panel, Tag } from "@/components/ui";
import { CONTACT_CATEGORIES } from "@/lib/types";

interface ContactView {
  id: number;
  name: string;
  title: string | null;
  category: string;
  email: string | null;
  outreachValue: number;
  status: string;
  isAlum: boolean;
  relevanceReason: string | null;
  hasDraft: boolean;
  sentCount: number;
}

/**
 * People at this company, and the entry point to outreach.
 *
 * Contact discovery searches your own mailbox rather than scraping profiles,
 * so most contacts here will be ones you add by hand. The form is right there
 * for that reason.
 */
export function ContactsPanel({
  jobId,
  companyId,
  companyName,
  applicationId,
  contacts,
}: {
  jobId: number;
  companyId: number;
  companyName: string;
  applicationId: number | null;
  contacts: ContactView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function post(path: string, payload: unknown, key: string) {
    setBusy(key);
    setError(null);
    setNote(null);

    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    setBusy(null);

    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      setError(
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `Failed (${response.status})`,
      );
      return null;
    }

    router.refresh();
    return (await response.json()) as unknown;
  }

  async function discover() {
    const result = await post(
      "/api/contacts/discover",
      { companyId },
      "discover",
    );
    if (result !== null) {
      const typed = result as { found: number };
      setNote(
        typed.found === 0
          ? "Nobody from this company has emailed you. Add contacts by hand below."
          : `Found ${typed.found} contact(s) from your mailbox.`,
      );
    }
  }

  async function addContact(form: FormData) {
    const result = await post(
      "/api/contacts",
      {
        companyId,
        name: form.get("name"),
        title: form.get("title") || undefined,
        category: form.get("category") || undefined,
        email: form.get("email") || undefined,
        linkedinUrl: form.get("linkedinUrl") || undefined,
        isAlum: form.get("isAlum") === "on",
        relevanceReason: form.get("relevanceReason") || undefined,
      },
      "add",
    );
    if (result !== null) setAdding(false);
  }

  async function draft(contactId: number) {
    await post(
      "/api/outreach/generate",
      { contactId, jobId, applicationId, kind: "initial" },
      `draft-${contactId}`,
    );
  }

  const inputClass =
    "w-full rounded-md border border-border bg-surface px-2 py-1 outline-none focus:border-accent";

  return (
    <Panel className="p-3">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="eyebrow">People at {companyName}</h2>
        <button
          type="button"
          onClick={discover}
          disabled={busy !== null}
          className="ml-auto rounded border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
          title="Searches your Gmail for people at this company who have emailed you"
        >
          {busy === "discover" ? "Searching…" : "Search my mail"}
        </button>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-text"
        >
          {adding ? "Cancel" : "Add"}
        </button>
      </div>

      {note !== null && <p className="mb-2 text-[11px] text-faint">{note}</p>}
      {error !== null && (
        <p className="mb-2 rounded-md bg-danger-soft px-2 py-1 text-[11px] text-danger">
          {error}
        </p>
      )}

      {adding && (
        <form
          action={addContact}
          className="mb-3 flex flex-col gap-1.5 rounded-md border border-border p-2"
        >
          <input name="name" required placeholder="Name" className={inputClass} />
          <input name="title" placeholder="Title" className={inputClass} />
          <select name="category" defaultValue="technical_recruiter" className={inputClass}>
            {CONTACT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <input name="email" type="email" placeholder="Work email" className={inputClass} />
          <input name="linkedinUrl" placeholder="LinkedIn URL" className={inputClass} />
          <input
            name="relevanceReason"
            placeholder="Why they're relevant"
            className={inputClass}
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-faint">
            <input type="checkbox" name="isAlum" className="accent-accent" />
            Same university as me
          </label>
          <button
            type="submit"
            disabled={busy === "add"}
            className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg disabled:opacity-40"
          >
            {busy === "add" ? "Adding…" : "Add contact"}
          </button>
        </form>
      )}

      {contacts.length === 0 ? (
        <p className="text-[11px] text-faint">
          No contacts yet. Search your mail, or add a recruiter you found on the
          company&apos;s careers page.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {contacts.map((contact) => (
            <div key={contact.id} className="border-t border-border pt-2 first:border-0 first:pt-0">
              <div className="flex items-baseline gap-2">
                <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-accent">
                  {contact.outreachValue}
                </span>
                <span className="truncate font-medium">{contact.name}</span>
                {contact.isAlum && <Tag>alum</Tag>}
                {contact.sentCount > 0 && <Tag tone="muted">emailed</Tag>}
              </div>
              <p className="ml-9 truncate text-[11px] text-faint">
                {contact.title ?? contact.category.replace(/_/g, " ")}
                {contact.email !== null ? ` · ${contact.email}` : " · no email"}
              </p>
              {contact.relevanceReason !== null && (
                <p className="ml-9 text-[11px] text-faint">{contact.relevanceReason}</p>
              )}

              <div className="ml-9 mt-1 flex items-center gap-1.5">
                {contact.hasDraft ? (
                  <Link
                    href="/outreach"
                    className="rounded border border-border px-1.5 py-0.5 text-[11px] text-accent"
                  >
                    Draft ready →
                  </Link>
                ) : contact.sentCount > 0 ? (
                  <span className="text-[11px] text-faint">
                    Already contacted about this role
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => draft(contact.id)}
                    disabled={busy !== null || contact.email === null}
                    title={
                      contact.email === null
                        ? "Add an email address first"
                        : undefined
                    }
                    className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
                  >
                    {busy === `draft-${contact.id}` ? "Writing…" : "Draft outreach"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
