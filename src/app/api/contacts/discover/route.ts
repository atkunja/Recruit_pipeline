import { badRequest, handleError, ok, readJson } from "@/lib/api";
import { discoverContactsForCompany } from "@/lib/contacts/discover";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
  companyId?: number;
}

/**
 * Find people at a company worth contacting.
 *
 * Searches your own mailbox for humans at that company who have already
 * written to you. It does not scrape profiles or guess email addresses.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson<Body>(request);
    if (typeof body.companyId !== "number") {
      return badRequest("companyId is required");
    }

    return ok(await discoverContactsForCompany(body.companyId));
  } catch (error) {
    return handleError(error, "contacts.discover");
  }
}
