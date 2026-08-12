import { badRequest, handleError, numericParam, ok } from "@/lib/api";
import { buildApplicationPackage } from "@/lib/apply/package";

export const runtime = "nodejs";

/** Everything the Playwright CLI needs to fill one application. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const applicationId = numericParam(id);
    if (applicationId === null) return badRequest("Invalid application id");

    return ok(await buildApplicationPackage(applicationId));
  } catch (error) {
    return handleError(error, "applications.package");
  }
}
