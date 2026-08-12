import { badRequest, handleError, notFound, numericParam, ok, readJson } from "@/lib/api";
import { sql } from "@/lib/db";
import { setContactStatus } from "@/lib/contacts/repository";
import type { Contact, ContactStatus } from "@/lib/types";

export const runtime = "nodejs";

const STATUSES: ContactStatus[] = [
  "identified",
  "queued",
  "contacted",
  "replied",
  "bounced",
  "do_not_contact",
];

interface Body {
  status?: string;
  email?: string;
  title?: string;
  outreachValue?: number;
  notes?: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const contactId = numericParam(id);
    if (contactId === null) return badRequest("Invalid contact id");

    const body = await readJson<Body>(request);

    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as ContactStatus)) {
        return badRequest(`status must be one of: ${STATUSES.join(", ")}`);
      }
      await setContactStatus(contactId, body.status as ContactStatus);
    }

    const rows = await sql<Contact[]>`
      update contacts set
        email          = coalesce(${body.email ?? null}, email),
        title          = coalesce(${body.title ?? null}, title),
        outreach_value = coalesce(${body.outreachValue ?? null}, outreach_value),
        notes          = coalesce(${body.notes ?? null}, notes),
        updated_at     = now()
      where id = ${contactId}
      returning *
    `;

    const contact = rows[0];
    if (!contact) return notFound("Contact not found");
    return ok(contact);
  } catch (error) {
    return handleError(error, "contacts.patch");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const contactId = numericParam(id);
    if (contactId === null) return badRequest("Invalid contact id");

    await sql`delete from contacts where id = ${contactId}`;
    return ok({ ok: true });
  } catch (error) {
    return handleError(error, "contacts.delete");
  }
}
