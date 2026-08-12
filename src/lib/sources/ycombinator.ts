import { getJson } from "./types";
import type { CompanyCandidate } from "./board-discovery";
import type { CompanyCategory } from "../types";

/**
 * Y Combinator company directory.
 *
 * YC's own directory page is a client-rendered app with no public API, so this
 * reads the yc-oss mirror — a community-maintained JSON export of the same
 * public directory, refreshed daily.
 *
 * This is not a job adapter: it produces *company candidates* for board
 * discovery. YC startups overwhelmingly run Greenhouse, Lever or Ashby, so
 * finding their board is what actually unlocks their postings.
 */

interface YcCompany {
  id?: number;
  name?: string;
  slug?: string;
  website?: string;
  batch?: string;
  status?: string;
  isHiring?: boolean;
  team_size?: number;
  industry?: string;
  subindustry?: string;
  industries?: string[];
  tags?: string[];
  regions?: string[];
  all_locations?: string;
  top_company?: boolean;
}

const ENDPOINT = "https://yc-oss.github.io/api/companies/all.json";

/** Industries and tags that imply the company hires software interns. */
const RELEVANT = [
  "b2b", "engineering", "developer tools", "devtools", "infrastructure",
  "saas", "analytics", "data", "artificial intelligence", "ai", "machine learning",
  "fintech", "security", "cloud", "api", "robotics", "autonomous", "hard tech",
  "aerospace", "defense", "logistics", "productivity", "database", "open source",
];

export interface YcFilter {
  /** Skip companies smaller than this; tiny teams rarely run internships. */
  minTeamSize?: number;
  /** Only batches at or after this year, e.g. 2018. */
  minBatchYear?: number;
  /** Require the directory's hiring flag. */
  onlyHiring?: boolean;
  /** Cap the number of candidates returned. */
  limit?: number;
}

export async function fetchYcCandidates(
  signal: AbortSignal,
  filter: YcFilter = {},
): Promise<CompanyCandidate[]> {
  const {
    minTeamSize = 15,
    minBatchYear = 2015,
    onlyHiring = true,
    limit = 1200,
  } = filter;

  const companies = await getJson<YcCompany[]>(ENDPOINT, signal, 60_000);

  const candidates: CompanyCandidate[] = [];

  for (const company of Array.isArray(companies) ? companies : []) {
    const name = company.name?.trim();
    if (!name) continue;

    if (company.status !== undefined && company.status !== "Active") continue;
    if (onlyHiring && company.isHiring !== true) continue;
    if ((company.team_size ?? 0) < minTeamSize) continue;

    const batchYear = parseBatchYear(company.batch);
    if (batchYear !== null && batchYear < minBatchYear) continue;

    // US-based or US-region companies only — matches the search scope.
    const regions = company.regions ?? [];
    const locations = company.all_locations ?? "";
    const isUnitedStates =
      regions.some((region) => /america|united states|remote/i.test(region)) ||
      /,\s*[A-Z]{2}\b|United States|USA/.test(locations);
    if (!isUnitedStates) continue;

    if (!isRelevant(company)) continue;

    candidates.push({
      externalKey: `yc:${company.slug ?? company.id ?? name}`,
      name,
      website: company.website ?? null,
      slugHints: company.slug ? [company.slug] : [],
      category: categoryFor(company),
    });

    if (candidates.length >= limit) break;
  }

  // Bigger, more established teams first — they run structured internships.
  return candidates.sort((a, b) => a.name.localeCompare(b.name));
}

function isRelevant(company: YcCompany): boolean {
  const haystack = [
    company.industry ?? "",
    company.subindustry ?? "",
    ...(company.industries ?? []),
    ...(company.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return RELEVANT.some((term) => haystack.includes(term));
}

function categoryFor(company: YcCompany): CompanyCategory {
  const haystack = [
    company.industry ?? "",
    company.subindustry ?? "",
    ...(company.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  if (/robotic|autonomous|drone/.test(haystack)) return "robotics";
  if (/developer tool|devtools|api|open source/.test(haystack)) return "devtools";
  if (/infrastructure|cloud|database|devops/.test(haystack)) return "infrastructure";
  if (/artificial intelligence|machine learning|\bai\b/.test(haystack)) return "ai";
  if (/fintech|payments|banking/.test(haystack)) return "fintech";
  if (/defense|aerospace/.test(haystack)) return "defense";
  return "startup";
}

/** "Winter 2012" / "W12" / "Summer 2021" → 2012, 2012, 2021. */
export function parseBatchYear(batch: string | undefined): number | null {
  if (!batch) return null;

  const fullYear = /\b(20\d\d|19\d\d)\b/.exec(batch);
  if (fullYear?.[1] !== undefined) return Number(fullYear[1]);

  const short = /^[WSFwsf](\d\d)$/.exec(batch.trim());
  if (short?.[1] !== undefined) {
    const value = Number(short[1]);
    return value > 50 ? 1900 + value : 2000 + value;
  }
  return null;
}
