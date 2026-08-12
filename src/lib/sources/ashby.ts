import { htmlToText } from "../jobs/normalize";
import { configString, getJson, type RawPosting, type SourceAdapter } from "./types";

/**
 * Ashby job boards.
 *
 * The public posting API returns the whole board in one call, descriptions
 * included.
 *
 * Config: { "org": "openai", "displayName": "OpenAI" }
 */

interface AshbyJob {
  id?: string;
  title?: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  department?: string;
  team?: string;
  isRemote?: boolean;
  descriptionPlain?: string;
  description?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  employmentType?: string;
  compensation?: {
    compensationTierSummary?: string;
    summaryComponents?: { summary?: string }[];
  };
}

interface AshbyResponse {
  jobs?: AshbyJob[];
}

export const ashbyAdapter: SourceAdapter = {
  kind: "ashby",
  label: "Ashby",

  async fetch(config, context) {
    const org = configString(config, "org");
    const displayName =
      typeof config.displayName === "string" && config.displayName.length > 0
        ? config.displayName
        : titleCase(org);

    const data = await getJson<AshbyResponse>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`,
      context.signal,
    );

    const postings: RawPosting[] = [];

    for (const job of data.jobs ?? []) {
      const title = job.title?.trim();
      const url = job.jobUrl ?? job.applyUrl;
      if (!title || !url) continue;
      if (!context.isTitleInteresting(title)) continue;

      const secondary = (job.secondaryLocations ?? [])
        .map((entry) => entry.location)
        .filter((value): value is string => typeof value === "string");

      const locations = [job.location, ...secondary].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );

      postings.push({
        companyName: displayName,
        title,
        url,
        sourceJobId: job.id ?? null,
        locationRaw:
          locations.length > 0
            ? locations.join("; ")
            : job.isRemote === true
              ? "Remote"
              : null,
        description:
          job.descriptionPlain ??
          htmlToText(job.descriptionHtml ?? job.description ?? "") ??
          null,
        postedAt: job.publishedAt ? new Date(job.publishedAt) : null,
        compensation: readCompensation(job),
        raw: { id: job.id, team: job.team, department: job.department },
      });
    }

    return postings;
  },
};

function readCompensation(job: AshbyJob): string | null {
  const tier = job.compensation?.compensationTierSummary;
  if (typeof tier === "string" && tier.length > 0) return tier;

  const components = (job.compensation?.summaryComponents ?? [])
    .map((component) => component.summary)
    .filter((value): value is string => typeof value === "string");

  return components.length > 0 ? components.join(" · ") : null;
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
