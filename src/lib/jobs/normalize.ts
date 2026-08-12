import { createHash } from "node:crypto";

/**
 * Pure normalization helpers shared by every source adapter.
 *
 * Everything here is deterministic and dependency-free so it can be unit
 * tested without a database, and so two adapters that see the same real-world
 * job independently derive the same dedupe key.
 */

/** Legal suffixes that differ between boards for the same company. */
const COMPANY_SUFFIXES =
  /\b(inc|inc\.|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|holdings|technologies|technology|labs|group)\b/g;

/**
 * Stable company key. "Databricks, Inc." and "databricks" collapse to
 * "databricks" so the same employer is one row.
 */
export function slugifyCompany(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .replace(/&/g, " and ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  // Never return an empty key — it would collapse unrelated companies together.
  return slug.length > 0 ? slug : hashText(name).slice(0, 12);
}

/** Noise words that vary between postings of the same role. */
const TITLE_NOISE =
  /\b(intern|internship|interns|co-?op|summer|fall|winter|spring|20\d\d|us|usa|united states|remote|hybrid|onsite|new grad|university|student|undergraduate|undergrad|program|opportunity|hiring|multiple locations|various)\b/g;

const LEVEL_NOISE = /\b(i{1,3}|iv|v|jr|junior|sr|senior|staff|principal|level \d|l\d|entry[- ]level)\b/g;

/**
 * Comparable form of a job title: lowercase, seasons/years/levels removed,
 * parentheticals dropped, whitespace collapsed.
 *
 * "Software Engineer Intern (Summer 2027) - Cloud" → "software engineer cloud"
 */
export function normalizeTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[–—|/,:;]+/g, " ")
    .replace(TITLE_NOISE, " ")
    .replace(LEVEL_NOISE, " ")
    .replace(/[^a-z0-9+#. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : title.toLowerCase().trim();
}

/** sha256 hex digest, used for description change detection and dedupe keys. */
export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Identity for "the same real-world posting".
 *
 * Company + normalized title + primary location. Location is included because
 * a company genuinely posts the same title in several cities and those are
 * different opportunities; the season is not, because a single posting is
 * often listed with and without it.
 */
export function buildDedupeKey(
  companySlug: string,
  title: string,
  primaryLocation: string | null,
): string {
  const location = (primaryLocation ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return hashText(`${companySlug}::${normalizeTitle(title)}::${location}`).slice(
    0,
    32,
  );
}

const REMOTE_PATTERN = /\b(remote|work from home|wfh|distributed|anywhere)\b/i;
const HYBRID_PATTERN = /\bhybrid\b/i;

export function detectRemote(locationRaw: string | null | undefined): boolean {
  if (!locationRaw) return false;
  // "Remote (Hybrid)" is not remote; hybrid wins when both appear.
  if (HYBRID_PATTERN.test(locationRaw)) return false;
  return REMOTE_PATTERN.test(locationRaw);
}

/** US state names and abbreviations, used to decide whether a job is in-country. */
const US_STATES = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il",
  "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt",
  "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri",
  "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc",
]);

const NON_US_MARKERS = [
  "canada", "toronto", "vancouver", "montreal", "ontario", "london", "uk",
  "united kingdom", "ireland", "dublin", "germany", "berlin", "munich",
  "france", "paris", "netherlands", "amsterdam", "switzerland", "zurich",
  "israel", "tel aviv", "india", "bangalore", "bengaluru", "hyderabad",
  "singapore", "japan", "tokyo", "china", "beijing", "shanghai", "australia",
  "sydney", "brazil", "mexico", "poland", "warsaw", "spain", "madrid",
  "sweden", "stockholm", "korea", "seoul", "taiwan", "hong kong",
];

/**
 * Split a board's free-form location string into individual locations.
 * Boards use ";", "|", " or " and " / " more or less interchangeably.
 */
export function parseLocations(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s*(?:;|\||\bor\b|\+|(?<=[a-z])\s\/\s(?=[A-Z]))\s*/i)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter((part) => part.length > 0 && part.length < 80)
    .slice(0, 12);
}

/** True when any parsed location looks like it is inside the United States. */
export function isUnitedStates(locations: string[]): boolean {
  if (locations.length === 0) return false;

  for (const location of locations) {
    const lower = location.toLowerCase();

    if (NON_US_MARKERS.some((marker) => lower.includes(marker))) continue;
    if (/\b(usa|u\.s\.|united states|us)\b/.test(lower)) return true;
    if (REMOTE_PATTERN.test(lower)) return true;

    // "Ann Arbor, MI" / "New York, NY 10001"
    const stateMatch = /,\s*([a-z]{2})\b/.exec(lower);
    if (stateMatch?.[1] !== undefined && US_STATES.has(stateMatch[1])) return true;
  }
  return false;
}

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";

/**
 * Infer the internship season from the title first, then the description.
 * Returns e.g. "Summer 2027", or null when the posting never says.
 */
export function detectSeason(
  title: string,
  description?: string | null,
): string | null {
  const fromTitle = seasonIn(title);
  if (fromTitle !== null) return fromTitle;

  if (description) {
    // Only look at the opening of a description — later mentions are usually
    // boilerplate about other programs.
    return seasonIn(description.slice(0, 2500));
  }
  return null;
}

function seasonIn(text: string): string | null {
  const lower = text.toLowerCase();

  const explicit = new RegExp(
    `\\b(summer|fall|autumn|winter|spring)\\b[^a-z0-9]{0,12}(20\\d\\d)`,
    "i",
  ).exec(lower);
  if (explicit?.[1] !== undefined && explicit[2] !== undefined) {
    return `${capitalize(explicit[1])} ${explicit[2]}`;
  }

  const reversed = new RegExp(
    `\\b(20\\d\\d)\\b[^a-z0-9]{0,12}(summer|fall|autumn|winter|spring)\\b`,
    "i",
  ).exec(lower);
  if (reversed?.[1] !== undefined && reversed[2] !== undefined) {
    return `${capitalize(reversed[2])} ${reversed[1]}`;
  }

  // "May 2027 - August 2027" implies a summer term.
  const range = new RegExp(`\\b(${MONTHS})\\s+(20\\d\\d)`, "i").exec(lower);
  if (range?.[1] !== undefined && range[2] !== undefined) {
    const month = range[1].toLowerCase();
    if (["may", "june", "july", "august"].includes(month)) {
      return `Summer ${range[2]}`;
    }
  }

  // A bare year on an internship posting almost always means that summer.
  const bareYear = /\b(20[2-4]\d)\b/.exec(lower);
  if (bareYear?.[1] !== undefined && /\bintern/i.test(lower)) {
    return `Summer ${bareYear[1]}`;
  }

  return null;
}

function capitalize(word: string): string {
  const lower = word.toLowerCase();
  // "Autumn" postings mean the same term as "Fall"; normalize to one label.
  const canonical = lower === "autumn" ? "fall" : lower;
  return canonical.charAt(0).toUpperCase() + canonical.slice(1);
}

/** Strip HTML to readable text. Boards return descriptions as HTML fragments. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Pull the "Requirements"/"Qualifications" section out of a description so the
 * prefilter and scorer can weight it separately from marketing copy.
 */
export function extractSections(description: string): {
  requirements: string | null;
  preferred: string | null;
} {
  const requirements = sectionAfter(description, [
    "basic qualifications",
    "minimum qualifications",
    "requirements",
    "required qualifications",
    "what you'll need",
    "what we're looking for",
    "qualifications",
  ]);
  const preferred = sectionAfter(description, [
    "preferred qualifications",
    "nice to have",
    "bonus points",
    "preferred",
    "plus",
  ]);
  return { requirements, preferred };
}

function sectionAfter(text: string, headings: string[]): string | null {
  for (const heading of headings) {
    const index = text.toLowerCase().indexOf(heading);
    if (index === -1) continue;
    const body = text.slice(index + heading.length, index + heading.length + 2000);
    const trimmed = body.replace(/^[:\s]+/, "").trim();
    if (trimmed.length > 40) return trimmed;
  }
  return null;
}
