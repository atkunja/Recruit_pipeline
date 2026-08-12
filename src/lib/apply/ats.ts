import type { SourceKind } from "../types";

/**
 * ATS detection and the field mapping each one uses.
 *
 * Pure, so the Playwright CLI and the server agree on what platform a URL is
 * and what to type where.
 */

export type AtsPlatform =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "unknown";

export function detectAts(url: string): AtsPlatform {
  let host = "";
  let path = "";
  let query = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname.toLowerCase();
    query = parsed.search.toLowerCase();
  } catch {
    return "unknown";
  }

  // `gh_jid` is a query parameter on company careers pages that embed a
  // Greenhouse form, so both the path and the query have to be checked.
  if (host.includes("greenhouse.io") || query.includes("gh_jid") || path.includes("gh_jid")) {
    return "greenhouse";
  }
  if (host.includes("lever.co")) return "lever";
  if (host.includes("ashbyhq.com")) return "ashby";
  if (host.includes("myworkday") || host.includes("workday.com")) return "workday";
  return "unknown";
}

export function atsFromSourceKind(kind: SourceKind): AtsPlatform {
  switch (kind) {
    case "greenhouse":
      return "greenhouse";
    case "lever":
      return "lever";
    case "ashby":
      return "ashby";
    case "workday":
      return "workday";
    default:
      return "unknown";
  }
}

/** A field the filler knows how to populate. */
export interface FieldSelector {
  /** Which profile value goes here. */
  field: ProfileField;
  /** CSS selectors, tried in order. */
  selectors: string[];
  /** True for file inputs (the resume). */
  file?: boolean;
}

export type ProfileField =
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "location"
  | "school"
  | "degree"
  | "major"
  | "graduationDate"
  | "gpa"
  | "linkedin"
  | "github"
  | "portfolio"
  | "resume";

/**
 * Per-platform selectors.
 *
 * Deliberately several selectors per field: these forms change, and a stale
 * selector should degrade to "couldn't fill that one, flagging it" rather than
 * to a crash or, worse, typing an email into a name box.
 */
export const FIELD_MAPS: Record<AtsPlatform, FieldSelector[]> = {
  greenhouse: [
    { field: "firstName", selectors: ["#first_name", "input[name='first_name']", "input[autocomplete='given-name']"] },
    { field: "lastName", selectors: ["#last_name", "input[name='last_name']", "input[autocomplete='family-name']"] },
    { field: "email", selectors: ["#email", "input[name='email']", "input[type='email']"] },
    { field: "phone", selectors: ["#phone", "input[name='phone']", "input[type='tel']"] },
    { field: "resume", selectors: ["#resume", "input[type='file'][name*='resume']", "input[type='file']"], file: true },
    { field: "linkedin", selectors: ["input[name*='linkedin' i]", "input[id*='linkedin' i]"] },
    { field: "github", selectors: ["input[name*='github' i]", "input[id*='github' i]"] },
    { field: "school", selectors: ["input[name*='school' i]", "#education_school_name_0", "input[id*='school' i]"] },
    { field: "degree", selectors: ["input[name*='degree' i]", "#education_degree_0"] },
    { field: "major", selectors: ["input[name*='discipline' i]", "input[name*='major' i]"] },
  ],
  lever: [
    { field: "fullName", selectors: ["input[name='name']", "#name"] },
    { field: "email", selectors: ["input[name='email']", "#email", "input[type='email']"] },
    { field: "phone", selectors: ["input[name='phone']", "#phone", "input[type='tel']"] },
    { field: "location", selectors: ["input[name='location']", "#location"] },
    { field: "resume", selectors: ["input[name='resume']", "input[type='file']"], file: true },
    { field: "linkedin", selectors: ["input[name*='linkedin' i]", "input[name='urls[LinkedIn]']"] },
    { field: "github", selectors: ["input[name*='github' i]", "input[name='urls[GitHub]']"] },
    { field: "portfolio", selectors: ["input[name='urls[Portfolio]']", "input[name*='portfolio' i]"] },
    { field: "school", selectors: ["input[name*='school' i]", "input[name*='org' i]"] },
  ],
  ashby: [
    { field: "fullName", selectors: ["input[name='_systemfield_name']", "input[aria-label*='Name' i]"] },
    { field: "email", selectors: ["input[name='_systemfield_email']", "input[type='email']"] },
    { field: "phone", selectors: ["input[name='_systemfield_phone']", "input[type='tel']"] },
    { field: "resume", selectors: ["input[type='file']"], file: true },
    { field: "linkedin", selectors: ["input[aria-label*='LinkedIn' i]", "input[name*='linkedin' i]"] },
    { field: "github", selectors: ["input[aria-label*='GitHub' i]", "input[name*='github' i]"] },
    { field: "school", selectors: ["input[aria-label*='School' i]", "input[name*='school' i]"] },
  ],
  workday: [
    // Workday is a multi-step SPA with generated ids; these cover the first
    // "My Information" step only. Everything after it is flagged for the user.
    { field: "firstName", selectors: ["input[data-automation-id='legalNameSection_firstName']"] },
    { field: "lastName", selectors: ["input[data-automation-id='legalNameSection_lastName']"] },
    { field: "email", selectors: ["input[data-automation-id='email']", "input[type='email']"] },
    { field: "phone", selectors: ["input[data-automation-id='phone-number']", "input[type='tel']"] },
    { field: "resume", selectors: ["input[data-automation-id='file-upload-input-ref']", "input[type='file']"], file: true },
  ],
  unknown: [],
};

/** How complete an automated attempt is likely to be. */
export const PLATFORM_SUPPORT: Record<
  AtsPlatform,
  { level: "good" | "partial" | "none"; note: string }
> = {
  greenhouse: {
    level: "good",
    note: "Contact details, links and resume fill reliably. Custom questions are flagged.",
  },
  lever: {
    level: "good",
    note: "Contact details, links and resume fill reliably. Custom questions are flagged.",
  },
  ashby: {
    level: "partial",
    note: "Ashby renders fields dynamically; expect to check a few by hand.",
  },
  workday: {
    level: "partial",
    note: "Only the first step is filled. Workday requires an account and several steps — the rest is yours.",
  },
  unknown: {
    level: "none",
    note: "Unrecognised application system. The package below has everything you need to fill it in by hand.",
  },
};
