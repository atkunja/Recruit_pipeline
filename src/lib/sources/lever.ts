import { htmlToText } from "../jobs/normalize";
import { configString, getJson, type RawPosting, type SourceAdapter } from "./types";

/**
 * Lever job boards.
 *
 * `/v0/postings/{company}?mode=json` returns every posting with its full
 * description, so one request per company.
 *
 * Config: { "company": "ramp", "displayName": "Ramp" }
 */

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  descriptionPlain?: string;
  description?: string;
  additionalPlain?: string;
  categories?: {
    location?: string;
    allLocations?: string[];
    team?: string;
    commitment?: string;
  };
  lists?: { text?: string; content?: string }[];
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

export const leverAdapter: SourceAdapter = {
  kind: "lever",
  label: "Lever",

  async fetch(config, context) {
    const company = configString(config, "company");
    const displayName =
      typeof config.displayName === "string" && config.displayName.length > 0
        ? config.displayName
        : titleCase(company);

    const data = await getJson<LeverPosting[]>(
      `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`,
      context.signal,
    );

    const postings: RawPosting[] = [];

    for (const posting of Array.isArray(data) ? data : []) {
      const title = posting.text?.trim();
      const url = posting.hostedUrl ?? posting.applyUrl;
      if (!title || !url) continue;
      if (!context.isTitleInteresting(title)) continue;

      const locations =
        posting.categories?.allLocations &&
        posting.categories.allLocations.length > 0
          ? posting.categories.allLocations.join("; ")
          : (posting.categories?.location ?? null);

      postings.push({
        companyName: displayName,
        title,
        url,
        sourceJobId: posting.id ?? null,
        locationRaw: locations,
        description: buildDescription(posting),
        postedAt: posting.createdAt ? new Date(posting.createdAt) : null,
        compensation: formatSalary(posting.salaryRange),
        raw: { id: posting.id, team: posting.categories?.team },
      });
    }

    return postings;
  },
};

/**
 * Lever splits a posting across `description`, a set of `lists` (requirements,
 * responsibilities), and `additionalPlain`. The prefilter and scorer need all
 * three, so stitch them back together in reading order.
 */
function buildDescription(posting: LeverPosting): string | null {
  const parts: string[] = [];

  const intro =
    posting.descriptionPlain ??
    (posting.description ? htmlToText(posting.description) : "");
  if (intro.trim().length > 0) parts.push(intro.trim());

  for (const list of posting.lists ?? []) {
    const heading = list.text?.trim();
    const body = list.content ? htmlToText(list.content) : "";
    if (body.trim().length === 0) continue;
    parts.push(heading ? `${heading}\n${body.trim()}` : body.trim());
  }

  const extra = posting.additionalPlain?.trim();
  if (extra) parts.push(extra);

  const joined = parts.join("\n\n");
  return joined.length > 0 ? joined : null;
}

function formatSalary(range: LeverPosting["salaryRange"]): string | null {
  if (!range?.min && !range?.max) return null;
  const currency = range.currency ?? "USD";
  const interval = range.interval ? ` / ${range.interval}` : "";
  if (range.min && range.max) {
    return `${currency} ${range.min.toLocaleString()} – ${range.max.toLocaleString()}${interval}`;
  }
  const value = range.min ?? range.max;
  return value === undefined
    ? null
    : `${currency} ${value.toLocaleString()}${interval}`;
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
