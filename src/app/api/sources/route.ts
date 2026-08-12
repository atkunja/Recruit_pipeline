import { badRequest, handleError, ok, readJson } from "@/lib/api";
import { json, sql } from "@/lib/db";
import { getAdapter } from "@/lib/sources/registry";
import { SOURCE_KINDS, type JobSource, type SourceKind } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const sources = await sql<JobSource[]>`
      select * from job_sources order by priority desc, name asc
    `;
    return ok(sources);
  } catch (error) {
    return handleError(error, "sources.list");
  }
}

interface CreateBody {
  kind?: string;
  name?: string;
  config?: Record<string, unknown>;
  priority?: number;
}

/** Register a new board. Adding a source is data, not a deploy. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson<CreateBody>(request);

    const kind = body.kind as SourceKind | undefined;
    if (kind === undefined || !SOURCE_KINDS.includes(kind)) {
      return badRequest(`kind must be one of: ${SOURCE_KINDS.join(", ")}`);
    }
    if (getAdapter(kind) === null) {
      return badRequest(`No adapter is registered for "${kind}" yet.`);
    }

    const name = body.name?.trim();
    if (!name) return badRequest("name is required");

    const config = body.config ?? {};

    const rows = await sql<JobSource[]>`
      insert into job_sources (kind, name, config, priority)
      values (${kind}, ${name}, ${sql.json(json(config))}, ${body.priority ?? 0})
      on conflict (kind, name) do update
        set config = excluded.config, priority = excluded.priority, updated_at = now()
      returning *
    `;

    return ok(rows[0]);
  } catch (error) {
    return handleError(error, "sources.create");
  }
}
