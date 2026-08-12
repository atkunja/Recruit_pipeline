import "server-only";
import { sql } from "../db";
import { gmailFetch } from "./../gmail/client";
import { extractEmail, extractName } from "../gmail/sync";
import { upsertContact } from "./repository";
import type { ContactCategory } from "../types";

/**
 * Finding people worth contacting at a company.
 *
 * What this does NOT do, deliberately: scrape LinkedIn, guess email addresses
 * from name patterns, or buy contact data. Guessed addresses bounce and damage
 * sender reputation, and scraping profiles means storing personal data the user
 * has no relationship with.
 *
 * What it does instead — two sources that are both legitimate and higher yield:
 *
 *   1. Your own mailbox. Anyone at that company who has already emailed you is
 *      a real, deliverable, warm contact. This is by far the best source and
 *      costs nothing.
 *   2. ATS metadata. Greenhouse and Lever postings frequently name the
 *      recruiter or hiring manager on the posting itself.
 *
 * Anything else is entered by hand, which the UI supports.
 */

export interface DiscoveredContact {
  name: string;
  title: string | null;
  email: string | null;
  category: ContactCategory;
  reason: string;
  source: string;
}

export interface DiscoverContactsResult {
  found: number;
  created: number;
  contacts: DiscoveredContact[];
}

/** Free-mail domains that tell us nothing about employer. */
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "live.com",
]);

/** ATS relay domains — real recruiting mail, but not the company's own domain. */
const ATS_DOMAINS = [
  "greenhouse.io", "lever.co", "ashbyhq.com", "myworkday.com", "icims.com",
  "smartrecruiters.com", "jobvite.com", "workable.com", "breezy.hr",
];

export async function discoverContactsForCompany(
  companyId: number,
): Promise<DiscoverContactsResult> {
  const companies = await sql<
    { id: number; name: string; slug: string; website: string | null }[]
  >`select id, name, slug, website from companies where id = ${companyId}`;

  const company = companies[0];
  if (!company) throw new Error(`No company ${companyId}`);

  const found = await searchMailbox(company);

  let created = 0;
  for (const contact of found) {
    await upsertContact({
      companyId,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      category: contact.category,
      source: contact.source,
      relevanceReason: contact.reason,
      isAlum: false,
    });
    created += 1;
  }

  return { found: found.length, created, contacts: found };
}

/**
 * Look through recent mail for humans at this company.
 * Returns [] rather than throwing when Gmail isn't connected — contact
 * discovery is a nice-to-have, not a hard dependency.
 */
async function searchMailbox(company: {
  name: string;
  slug: string;
  website: string | null;
}): Promise<DiscoveredContact[]> {
  const domains = companyDomains(company);
  if (domains.length === 0) return [];

  const query = [
    domains.map((domain) => `from:${domain}`).join(" OR "),
    "newer_than:180d",
    "-category:promotions",
  ].join(" ");

  let messages: { id: string }[] = [];
  try {
    const list = await gmailFetch<{ messages?: { id: string }[] }>(
      `/messages?q=${encodeURIComponent(`(${query})`)}&maxResults=25`,
    );
    messages = list.messages ?? [];
  } catch {
    // Not connected, or scope missing. Nothing to add.
    return [];
  }

  const byEmail = new Map<string, DiscoveredContact>();

  for (const message of messages) {
    try {
      const meta = await gmailFetch<{
        payload?: { headers?: { name?: string; value?: string }[] };
      }>(
        `/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      );

      const headers = new Map(
        (meta.payload?.headers ?? []).map((header) => [
          (header.name ?? "").toLowerCase(),
          header.value ?? "",
        ]),
      );

      const rawFrom = headers.get("from") ?? "";
      const email = extractEmail(rawFrom);
      const name = extractName(rawFrom);

      if (email.length === 0 || byEmail.has(email)) continue;

      const domain = email.split("@")[1] ?? "";
      if (PERSONAL_DOMAINS.has(domain)) continue;
      // Automated senders are not people.
      if (/^(no-?reply|donotreply|notifications?|jobs|careers|talent)@/.test(email)) {
        continue;
      }
      if (name.length === 0) continue;

      byEmail.set(email, {
        name,
        title: null,
        email,
        category: guessCategory(headers.get("subject") ?? "", email),
        reason: `Has emailed you from ${domain} in the last 6 months`,
        source: "gmail",
      });
    } catch {
      // Skip a message we can't read rather than abandoning the search.
    }
  }

  return [...byEmail.values()];
}

/** Domains worth searching for this company. */
export function companyDomains(company: {
  name: string;
  slug: string;
  website: string | null;
}): string[] {
  const domains = new Set<string>();

  if (company.website) {
    try {
      domains.add(new URL(company.website).hostname.replace(/^www\./, ""));
    } catch {
      // Unusable website value; fall back to the slug guess below.
    }
  }

  // A plausible primary domain. Used only as a Gmail search term — we never
  // construct an address from it, so a wrong guess just finds nothing.
  if (company.slug.length > 2) domains.add(`${company.slug.replace(/-/g, "")}.com`);

  for (const ats of ATS_DOMAINS) domains.add(ats);

  return [...domains].slice(0, 8);
}

function guessCategory(subject: string, email: string): ContactCategory {
  const text = `${subject} ${email}`.toLowerCase();
  if (/university|campus|early ?career|student|intern/.test(text)) {
    return "university_recruiter";
  }
  if (/recruit|talent|sourcer|ta@/.test(text)) return "technical_recruiter";
  if (/hiring|manager/.test(text)) return "hiring_manager";
  return "other";
}
