import "server-only";
import { htmlToText } from "./normalize";
import type { SourceKind } from "../types";

/**
 * Best-effort extraction of a posting from a pasted URL.
 *
 * When the URL belongs to an ATS we recognise, we hit that ATS's public JSON
 * endpoint — clean title, location and description, no scraping. Otherwise we
 * fetch the page and strip the HTML, which is rough but good enough to score
 * against and to show in the detail view.
 */

export interface FetchedPosting {
  sourceKind: SourceKind;
  sourceJobId: string | null;
  companyName: string | null;
  title: string | null;
  locationRaw: string | null;
  description: string | null;
  postedAt: Date | null;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function fetchPosting(url: string): Promise<FetchedPosting> {
  const parsed = new URL(url);

  const greenhouse = matchGreenhouse(parsed);
  if (greenhouse) return fetchGreenhouse(greenhouse.board, greenhouse.jobId);

  const lever = matchLever(parsed);
  if (lever) return fetchLever(lever.company, lever.jobId);

  const ashby = matchAshby(parsed);
  if (ashby) return fetchAshby(ashby.company, ashby.jobId);

  return fetchGeneric(url);
}

// --- ATS URL matchers ------------------------------------------------------

function matchGreenhouse(
  url: URL,
): { board: string; jobId: string } | null {
  // boards.greenhouse.io/<board>/jobs/<id>  and job-boards.greenhouse.io/...
  if (!/greenhouse\.io$/.test(url.hostname.replace(/^.*?\./, ""))) {
    if (!url.hostname.includes("greenhouse.io")) return null;
  }
  const match = /\/([^/]+)\/jobs\/(\d+)/.exec(url.pathname);
  if (!match?.[1] || !match[2]) return null;
  return { board: match[1], jobId: match[2] };
}

function matchLever(url: URL): { company: string; jobId: string } | null {
  if (!url.hostname.includes("lever.co")) return null;
  // jobs.lever.co/<company>/<uuid>
  const match = /^\/([^/]+)\/([0-9a-f-]{16,})/i.exec(url.pathname);
  if (!match?.[1] || !match[2]) return null;
  return { company: match[1], jobId: match[2] };
}

function matchAshby(url: URL): { company: string; jobId: string } | null {
  if (!url.hostname.includes("ashbyhq.com")) return null;
  // jobs.ashbyhq.com/<company>/<uuid>
  const match = /^\/([^/]+)\/([0-9a-f-]{16,})/i.exec(url.pathname);
  if (!match?.[1] || !match[2]) return null;
  return { company: match[1], jobId: match[2] };
}

// --- ATS fetchers ----------------------------------------------------------

async function fetchGreenhouse(
  board: string,
  jobId: string,
): Promise<FetchedPosting> {
  const endpoint = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}?questions=false`;
  const data = await getJson<{
    title?: string;
    content?: string;
    location?: { name?: string };
    updated_at?: string;
    company_name?: string;
  }>(endpoint);

  return {
    sourceKind: "greenhouse",
    sourceJobId: jobId,
    companyName: data?.company_name ?? titleCase(board),
    title: data?.title ?? null,
    locationRaw: data?.location?.name ?? null,
    // Greenhouse returns HTML-escaped HTML.
    description: data?.content ? htmlToText(decodeEntities(data.content)) : null,
    postedAt: data?.updated_at ? new Date(data.updated_at) : null,
  };
}

async function fetchLever(
  company: string,
  jobId: string,
): Promise<FetchedPosting> {
  const endpoint = `https://api.lever.co/v0/postings/${company}/${jobId}`;
  const data = await getJson<{
    text?: string;
    descriptionPlain?: string;
    description?: string;
    categories?: { location?: string };
    createdAt?: number;
    lists?: { text?: string; content?: string }[];
    additionalPlain?: string;
  }>(endpoint);

  const sections = (data?.lists ?? [])
    .map((list) => `${list.text ?? ""}\n${htmlToText(list.content ?? "")}`)
    .join("\n\n");

  const description = [
    data?.descriptionPlain ?? htmlToText(data?.description ?? ""),
    sections,
    data?.additionalPlain ?? "",
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");

  return {
    sourceKind: "lever",
    sourceJobId: jobId,
    companyName: titleCase(company),
    title: data?.text ?? null,
    locationRaw: data?.categories?.location ?? null,
    description: description.length > 0 ? description : null,
    postedAt: data?.createdAt ? new Date(data.createdAt) : null,
  };
}

async function fetchAshby(
  company: string,
  jobId: string,
): Promise<FetchedPosting> {
  // Ashby's public board API returns every posting for the org; find ours.
  const endpoint = `https://api.ashbyhq.com/posting-api/job-board/${company}?includeCompensation=true`;
  const data = await getJson<{
    jobs?: {
      id?: string;
      title?: string;
      location?: string;
      descriptionPlain?: string;
      description?: string;
      publishedAt?: string;
    }[];
  }>(endpoint);

  const posting = data?.jobs?.find((job) => job.id === jobId);

  return {
    sourceKind: "ashby",
    sourceJobId: jobId,
    companyName: titleCase(company),
    title: posting?.title ?? null,
    locationRaw: posting?.location ?? null,
    description:
      posting?.descriptionPlain ??
      (posting?.description ? htmlToText(posting.description) : null),
    postedAt: posting?.publishedAt ? new Date(posting.publishedAt) : null,
  };
}

/** Fall back to fetching the page and stripping tags. */
async function fetchGeneric(url: string): Promise<FetchedPosting> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Could not fetch ${url} (HTTP ${response.status})`);
  }

  const html = await response.text();
  const text = htmlToText(html);

  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const ogSite = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i.exec(html);

  return {
    sourceKind: "careers_page",
    sourceJobId: null,
    companyName: ogSite?.[1] ?? null,
    title: titleMatch?.[1]?.trim() ?? null,
    locationRaw: null,
    // Trim boilerplate nav/footer noise from both ends of a scraped page.
    description: text.length > 200 ? text.slice(0, 20_000) : null,
    postedAt: null,
  };
}

async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
