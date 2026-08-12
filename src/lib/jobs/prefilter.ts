import { detectRemote, isUnitedStates, normalizeTitle } from "./normalize";

/**
 * Deterministic prefilter.
 *
 * Runs on every discovered job *before* any model sees it, and is the main
 * reason this system costs a few dollars a month instead of a few hundred. A
 * typical discovery run pulls thousands of postings; single-digit percentages
 * of them survive to the scoring stage.
 *
 * Bias: when a signal is absent we pass. A missing season is not evidence of a
 * wrong season, and rejecting on absence would silently drop good jobs whose
 * boards are just terse.
 */

export interface PrefilterInput {
  title: string;
  description: string | null;
  locationRaw: string | null;
  locations: string[];
  season: string | null;
  isActive: boolean;
  closedAt: Date | null;
  /** True when an application row already exists for this job or its twin. */
  alreadyApplied?: boolean;
}

export interface PrefilterProfile {
  /** e.g. "Summer 2027" */
  targetSeason: string;
  /** Graduation date; used against "graduating in <year>" requirements. */
  graduationDate: Date;
  /** Set false to allow non-US postings. */
  requireUnitedStates?: boolean;
}

export interface PrefilterResult {
  verdict: "pass" | "reject";
  reasons: string[];
}

/** Words that make a posting an internship rather than a full-time role. */
const INTERN_MARKERS =
  /\b(intern|internship|co-?op|summer analyst|industrial placement|apprentice)\b/i;

/** Postings that are explicitly not internships. */
const NOT_INTERN_MARKERS =
  /\b(new grad(uate)?|entry[- ]level full[- ]time|full[- ]time only|experienced hire|staff engineer|senior engineer|principal engineer|manager|director|head of)\b/i;

/**
 * Technical role keywords.
 *
 * Deliberately permissive. The prefilter's job is to throw out what is
 * *certainly* wrong — marketing, HR, legal — not to guess which flavour of
 * technical work fits; that is the scorer's job, and it costs about a fifth of
 * a cent per posting.
 *
 * The narrow version of this list rejected "Quantitative Trader Intern",
 * "Quant Trading Intern", "Quantitative Researcher Intern" and "AI Research
 * Scientist Intern" — all roles at exactly the trading and AI firms being
 * targeted — because it matched "quantitative trading" but not "trader".
 */
const TECHNICAL_MARKERS = [
  "software", "swe", "sde", "backend", "back end", "back-end", "frontend",
  "front end", "front-end", "full stack", "fullstack", "full-stack",
  "infrastructure", "infra", "platform", "cloud", "distributed", "developer",
  "development", "devops", "site reliability", "sre", "systems", "system",
  "compiler", "kernel", "embedded", "firmware", "data engineer",
  "data engineering", "machine learning", "ml", "ai", "artificial intelligence",
  "deep learning", "computer vision", "nlp", "autonomy", "autonomous",
  "robotics", "perception", "controls", "quant", "quantitative", "trader",
  "trading", "algorithmic", "security", "network", "database", "engineering",
  "engineer", "programmer", "programming", "computer science", "computer",
  "technology", "technical", "research scientist", "applied scientist",
  "data scien", "data analytics", "analytics engineer", "simulation",
  "graphics", "gpu", "hardware engineer", "silicon", "fpga", "asic",
];

/** Roles that match "engineer" but are not software roles. */
const NON_SOFTWARE_MARKERS = [
  "mechanical engineer", "civil engineer", "chemical engineer",
  "electrical engineer", "industrial engineer", "manufacturing engineer",
  "process engineer", "structural engineer", "aerospace engineer",
  "hardware engineer", "test engineer technician", "field engineer",
  "sales engineer", "solutions engineer", "customer engineer",
  "engineering technician", "materials engineer", "petroleum engineer",
  "biomedical engineer", "environmental engineer", "quality engineer",
];

/** Degree requirements that exclude an undergraduate. */
const GRADUATE_ONLY =
  /\b(phd|ph\.d|doctoral|doctorate)\s+(candidates?|students?|required|only)|\bmust be (?:a |an )?(?:phd|ph\.d|master'?s|graduate) (?:student|candidate)|\b(?:phd|master'?s) (?:degree )?required\b/i;

/** Explicit "this posting is closed" language. */
const CLOSED_MARKERS =
  /\b(no longer accepting|this (?:position|role|posting) (?:has been|is) (?:filled|closed)|applications? (?:are )?closed|position filled)\b/i;

export function prefilter(
  job: PrefilterInput,
  profile: PrefilterProfile,
): PrefilterResult {
  const reasons: string[] = [];
  const reject = (reason: string): PrefilterResult => ({
    verdict: "reject",
    reasons: [reason],
  });

  if (job.alreadyApplied === true) return reject("Already applied");
  if (!job.isActive || job.closedAt !== null) return reject("Listing is closed");

  const title = job.title;
  const haystack = `${title}\n${job.description ?? ""}`;
  const descriptionHead = (job.description ?? "").slice(0, 6000);

  // --- 1. Is it an internship? --------------------------------------------
  const titleSaysIntern = INTERN_MARKERS.test(title);
  const bodySaysIntern = INTERN_MARKERS.test(descriptionHead);
  if (!titleSaysIntern && !bodySaysIntern) {
    return reject("Not an internship");
  }
  if (!titleSaysIntern && NOT_INTERN_MARKERS.test(title)) {
    return reject("Full-time or senior role, not an internship");
  }
  reasons.push("Internship");

  // --- 2. Is it a software role? ------------------------------------------
  const normalized = normalizeTitle(title);
  const lowerTitle = title.toLowerCase();

  const nonSoftware = NON_SOFTWARE_MARKERS.find((marker) =>
    lowerTitle.includes(marker),
  );
  // "Robotics Software Engineer" contains "software" and should survive even
  // though a bare "Hardware Engineer" should not.
  if (nonSoftware !== undefined && !/\b(software|firmware)\b/i.test(lowerTitle)) {
    return reject(`Non-software role (${nonSoftware})`);
  }

  const technical = TECHNICAL_MARKERS.some(
    (marker) => normalized.includes(marker) || lowerTitle.includes(marker),
  );
  if (!technical) return reject("Title is not a technical software role");
  reasons.push("Technical role");

  // --- 3. Season -----------------------------------------------------------
  if (job.season !== null && job.season !== profile.targetSeason) {
    return reject(`Wrong season (${job.season})`);
  }
  if (job.season === profile.targetSeason) reasons.push(job.season);

  // --- 4. Location ---------------------------------------------------------
  if (profile.requireUnitedStates !== false) {
    const remote = detectRemote(job.locationRaw);
    const locations =
      job.locations.length > 0
        ? job.locations
        : job.locationRaw !== null
          ? [job.locationRaw]
          : [];
    // No location at all is missing data, not a foreign job — let it through.
    if (locations.length > 0 && !remote && !isUnitedStates(locations)) {
      return reject(`Outside the United States (${locations[0] ?? "unknown"})`);
    }
    if (remote) reasons.push("Remote");
  }

  // --- 5. Degree level -----------------------------------------------------
  if (GRADUATE_ONLY.test(descriptionHead)) {
    return reject("Requires a graduate or PhD student");
  }

  // --- 6. Years of experience ---------------------------------------------
  const years = requiredYearsOfExperience(descriptionHead);
  if (years !== null && years >= 2) {
    return reject(`Requires ${years}+ years of experience`);
  }

  // --- 7. Graduation-window eligibility ------------------------------------
  const window = graduationWindow(descriptionHead);
  if (window !== null) {
    const graduationYear = profile.graduationDate.getUTCFullYear();
    if (graduationYear < window.min || graduationYear > window.max) {
      return reject(
        `Graduation year ${graduationYear} outside required ${window.min}–${window.max}`,
      );
    }
    reasons.push("Graduation year eligible");
  }

  // --- 8. Obviously expired ------------------------------------------------
  if (CLOSED_MARKERS.test(haystack)) return reject("Posting says it is closed");

  return { verdict: "pass", reasons };
}

/**
 * Largest "N+ years of experience" requirement in the text, or null.
 * Internship postings sometimes mention experience in a nice-to-have; we take
 * the maximum because the strictest statement is the binding one.
 */
export function requiredYearsOfExperience(text: string): number | null {
  const pattern =
    /(\d+)\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+|professional\s+|industry\s+|work\s+)?experience/gi;

  let max: number | null = null;
  for (const match of text.matchAll(pattern)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const value = Number(raw);
    // Ignore absurd parses like "20 years experience" in a company blurb.
    if (!Number.isFinite(value) || value > 15) continue;
    max = max === null ? value : Math.max(max, value);
  }
  return max;
}

/**
 * Graduation years the posting will accept, parsed from phrasings like
 * "graduating between December 2027 and June 2028" or "class of 2027".
 */
export function graduationWindow(
  text: string,
): { min: number; max: number } | null {
  const years: number[] = [];

  const range =
    /graduat\w*[^.]{0,60}?\b(20\d\d)\b[^.]{0,20}?(?:and|-|–|to|through)[^.]{0,20}?\b(20\d\d)\b/i.exec(
      text,
    );
  if (range?.[1] !== undefined && range[2] !== undefined) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  const patterns = [
    /graduat\w*[^.]{0,60}?\b(20\d\d)\b/gi,
    /class of\s+(20\d\d)/gi,
    /\b(20\d\d)\s+grad(?:uate)?s?\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1];
      if (raw === undefined) continue;
      const value = Number(raw);
      if (value >= 2024 && value <= 2035) years.push(value);
    }
  }

  if (years.length === 0) return null;
  return { min: Math.min(...years), max: Math.max(...years) };
}
