import { badRequest, handleError, ok, readJson } from "@/lib/api";
import { listContacts, upsertContact } from "@/lib/contacts/repository";
import { CONTACT_CATEGORIES, type ContactCategory } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const companyId = url.searchParams.get("companyId");
    return ok(
      await listContacts({
        companyId: companyId === null ? undefined : Number(companyId),
      }),
    );
  } catch (error) {
    return handleError(error, "contacts.list");
  }
}

interface Body {
  companyId?: number;
  name?: string;
  title?: string;
  category?: string;
  linkedinUrl?: string;
  email?: string;
  relevanceReason?: string;
  isAlum?: boolean;
  notes?: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson<Body>(request);

    if (typeof body.companyId !== "number") {
      return badRequest("companyId is required");
    }
    const name = body.name?.trim();
    if (!name) return badRequest("name is required");

    const category = body.category as ContactCategory | undefined;
    if (category !== undefined && !CONTACT_CATEGORIES.includes(category)) {
      return badRequest(`category must be one of: ${CONTACT_CATEGORIES.join(", ")}`);
    }

    const email = body.email?.trim().toLowerCase() || null;
    if (email !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return badRequest("That email address doesn't look valid");
    }

    const contact = await upsertContact({
      companyId: body.companyId,
      name,
      title: body.title?.trim() || null,
      category,
      linkedinUrl: body.linkedinUrl?.trim() || null,
      email,
      relevanceReason: body.relevanceReason?.trim() || null,
      isAlum: body.isAlum === true,
      notes: body.notes?.trim() || null,
      source: "manual",
    });

    return ok(contact);
  } catch (error) {
    return handleError(error, "contacts.create");
  }
}
