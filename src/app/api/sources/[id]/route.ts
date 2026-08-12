import { badRequest, handleError, notFound, numericParam, ok, readJson } from "@/lib/api";
import { sql } from "@/lib/db";
import type { JobSource } from "@/lib/types";

export const runtime = "nodejs";

interface PatchBody {
  enabled?: boolean;
  priority?: number;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const sourceId = numericParam(id);
    if (sourceId === null) return badRequest("Invalid source id");

    const body = await readJson<PatchBody>(request);

    const rows = await sql<JobSource[]>`
      update job_sources set
        enabled  = coalesce(${body.enabled ?? null}, enabled),
        priority = coalesce(${body.priority ?? null}, priority),
        -- Re-enabling a source clears its failure streak so it isn't skipped.
        consecutive_failures = case
          when ${body.enabled ?? null} is true then 0
          else consecutive_failures
        end,
        updated_at = now()
      where id = ${sourceId}
      returning *
    `;

    const source = rows[0];
    if (!source) return notFound("Source not found");
    return ok(source);
  } catch (error) {
    return handleError(error, "sources.patch");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const sourceId = numericParam(id);
    if (sourceId === null) return badRequest("Invalid source id");

    await sql`delete from job_sources where id = ${sourceId}`;
    return ok({ ok: true });
  } catch (error) {
    return handleError(error, "sources.delete");
  }
}
