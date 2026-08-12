import { getJson, type RawPosting, type SourceAdapter } from "./types";

/**
 * Pitt CSC × Simplify curated internship repositories.
 *
 * The repo publishes `.github/scripts/listings.json`: ~14k structured rows with
 * company, title, locations, term, degree requirements and sponsorship status.
 * That is far better data than parsing the README table, and it means one
 * request covers hundreds of companies that would otherwise need their own
 * board adapters.
 *
 * What it does not include is a job description, so postings come back here
 * without one; the discovery pipeline enriches the survivors of the prefilter
 * by fetching their ATS page. That ordering is deliberate — enriching first
 * would mean thousands of pointless requests.
 *
 * Config: {
 *   "repo": "SimplifyJobs/Summer2027-Internships",
 *   "branch": "dev",
 *   "categories": ["Software Engineering", "Quantitative Finance"]
 * }
 */

interface SimplifyListing {
  id?: string;
  company_name?: string;
  company_url?: string;
  title?: string;
  url?: string;
  locations?: string[];
  terms?: string[];
  degrees?: string[];
  sponsorship?: string;
  category?: string;
  active?: boolean;
  is_visible?: boolean;
  date_posted?: number;
  date_updated?: number;
}

/** Categories worth ingesting for a software-focused search. */
const DEFAULT_CATEGORIES = [
  "Software Engineering",
  "Data Science, AI & Machine Learning",
  "Quantitative Finance",
];

export const simplifyAdapter: SourceAdapter = {
  kind: "simplify",
  label: "Pitt CSC × Simplify",

  async fetch(config, context) {
    const repo =
      typeof config.repo === "string" && config.repo.length > 0
        ? config.repo
        : "SimplifyJobs/Summer2027-Internships";
    const branch =
      typeof config.branch === "string" && config.branch.length > 0
        ? config.branch
        : "dev";
    const categories = Array.isArray(config.categories)
      ? (config.categories as string[])
      : DEFAULT_CATEGORIES;
    const term = typeof config.term === "string" ? config.term : null;

    const listings = await getJson<SimplifyListing[]>(
      `https://raw.githubusercontent.com/${repo}/${branch}/.github/scripts/listings.json`,
      context.signal,
      45_000,
    );

    const wanted = new Set(categories);
    const postings: RawPosting[] = [];

    for (const listing of Array.isArray(listings) ? listings : []) {
      // The repo keeps closed roles around; we only want live ones.
      if (listing.active === false || listing.is_visible === false) continue;

      const title = listing.title?.trim();
      const company = listing.company_name?.trim();
      const url = listing.url?.trim();
      if (!title || !company || !url) continue;

      if (wanted.size > 0 && listing.category && !wanted.has(listing.category)) {
        continue;
      }

      // Term is the single strongest filter available here — using it drops
      // ~95% of the file before anything else runs.
      if (term !== null) {
        const terms = listing.terms ?? [];
        if (terms.length > 0 && !terms.includes(term)) continue;
      }

      // Explicitly graduate-only listings are not worth carrying forward.
      const degrees = listing.degrees ?? [];
      if (
        degrees.length > 0 &&
        !degrees.some((degree) => /bachelor|associate|undergrad/i.test(degree))
      ) {
        continue;
      }

      if (!context.isTitleInteresting(title)) continue;

      postings.push({
        companyName: company,
        title,
        url: stripTracking(url),
        sourceJobId: listing.id ?? null,
        locationRaw:
          listing.locations && listing.locations.length > 0
            ? listing.locations.join("; ")
            : null,
        // No description in this feed; the pipeline enriches survivors.
        description: null,
        postedAt:
          typeof listing.date_posted === "number"
            ? new Date(listing.date_posted * 1000)
            : null,
        companyWebsite: listing.company_url || null,
        raw: {
          category: listing.category,
          terms: listing.terms,
          degrees: listing.degrees,
          sponsorship: listing.sponsorship,
        },
      });
    }

    return postings;
  },
};

/**
 * Drop tracking parameters so the same posting has one stable URL.
 * The URL is a uniqueness key in `jobs`, and `?utm_source=Simplify` appearing
 * on one run but not the next would create a duplicate row.
 */
export function stripTracking(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|_gl$)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
