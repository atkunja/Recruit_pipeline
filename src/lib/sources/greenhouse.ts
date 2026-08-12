import { htmlToText } from "../jobs/normalize";
import { configString, getJson, type RawPosting, type SourceAdapter } from "./types";

/**
 * Greenhouse job boards.
 *
 * `?content=true` returns descriptions inline, so one request covers an entire
 * company — no per-posting fetch, which keeps a 300-company run to 300 requests.
 *
 * Config: { "board": "databricks", "company": "Databricks" }
 */

interface GreenhouseJob {
  id?: number;
  title?: string;
  absolute_url?: string;
  content?: string;
  updated_at?: string;
  location?: { name?: string };
  offices?: { name?: string }[];
  metadata?: { name?: string; value?: unknown }[];
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[];
  meta?: { total?: number };
}

export const greenhouseAdapter: SourceAdapter = {
  kind: "greenhouse",
  label: "Greenhouse",

  async fetch(config, context) {
    const board = configString(config, "board");
    const companyName =
      typeof config.company === "string" && config.company.length > 0
        ? config.company
        : titleCase(board);

    const data = await getJson<GreenhouseResponse>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
      context.signal,
    );

    const postings: RawPosting[] = [];

    for (const job of data.jobs ?? []) {
      const title = job.title?.trim();
      const url = job.absolute_url;
      if (!title || !url) continue;

      // Cheap title screen before we spend memory on the description.
      if (!context.isTitleInteresting(title)) continue;

      const offices = (job.offices ?? [])
        .map((office) => office.name)
        .filter((name): name is string => typeof name === "string");

      const location =
        job.location?.name ??
        (offices.length > 0 ? offices.join("; ") : null);

      postings.push({
        companyName,
        title,
        url,
        sourceJobId: job.id === undefined ? null : String(job.id),
        locationRaw: location,
        // Greenhouse double-encodes: HTML entities wrapping real HTML.
        description: job.content ? htmlToText(decodeEntities(job.content)) : null,
        postedAt: job.updated_at ? new Date(job.updated_at) : null,
        compensation: readCompensation(job),
        companyWebsite:
          typeof config.website === "string" ? config.website : null,
        raw: { id: job.id },
      });
    }

    return postings;
  },
};

/** Some boards publish a pay range as a custom metadata field. */
function readCompensation(job: GreenhouseJob): string | null {
  for (const field of job.metadata ?? []) {
    const name = field.name?.toLowerCase() ?? "";
    if (!/pay|salary|compensation|rate/.test(name)) continue;
    const value = field.value;
    if (typeof value === "string" && value.length > 0) return value;
    if (Array.isArray(value) && value.length > 0) return value.join(" – ");
  }
  return null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
