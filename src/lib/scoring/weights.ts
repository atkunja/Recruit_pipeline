import { createHash } from "node:crypto";
import { z } from "zod";
import type { ScoreComponentKey } from "../types";

/**
 * Scoring weights.
 *
 * The six components are the maximum points each dimension contributes, and
 * they are meant to sum to 100 so a total reads as a percentage. The company
 * preference bonus sits outside that sum: it is applied afterwards and the
 * result is clamped, so a dream company can nudge a job up without letting a
 * bad technical fit reach the top of the list.
 */

export const ScoringWeightsSchema = z.object({
  technical: z.number().int().min(0).max(100),
  experience: z.number().int().min(0).max(100),
  education: z.number().int().min(0).max(100),
  role: z.number().int().min(0).max(100),
  location: z.number().int().min(0).max(100),
  eligibility: z.number().int().min(0).max(100),
  /** Max points added (or removed) for company preference, ±. */
  companyPreferenceBonus: z.number().int().min(0).max(20),
  /** Jobs below this are hidden from Discover by default. */
  minimumDisplayScore: z.number().int().min(0).max(100),
});

export type ScoringWeights = z.infer<typeof ScoringWeightsSchema>;

export const DEFAULT_WEIGHTS: ScoringWeights = {
  technical: 35,
  experience: 25,
  education: 15,
  role: 10,
  location: 10,
  eligibility: 5,
  companyPreferenceBonus: 5,
  minimumDisplayScore: 60,
};

export const COMPONENT_KEYS: readonly ScoreComponentKey[] = [
  "technical",
  "experience",
  "education",
  "role",
  "location",
  "eligibility",
];

export const COMPONENT_LABELS: Record<ScoreComponentKey, string> = {
  technical: "Technical Match",
  experience: "Experience Match",
  education: "Education Match",
  role: "Role Preference",
  location: "Location",
  eligibility: "Eligibility",
};

/** Sum of the six scored components. Should be 100; the UI warns when it isn't. */
export function componentTotal(weights: ScoringWeights): number {
  return COMPONENT_KEYS.reduce((sum, key) => sum + weights[key], 0);
}

/**
 * Cache key for a weight configuration.
 *
 * Included in the `job_scores` unique index so retuning weights produces fresh
 * scores while leaving the old ones intact for comparison. `minimumDisplayScore`
 * is excluded on purpose — it filters the view, it does not change any score,
 * so changing it must not invalidate the cache and trigger a re-scoring bill.
 */
export function weightsHash(weights: ScoringWeights): string {
  const relevant = {
    technical: weights.technical,
    experience: weights.experience,
    education: weights.education,
    role: weights.role,
    location: weights.location,
    eligibility: weights.eligibility,
    companyPreferenceBonus: weights.companyPreferenceBonus,
  };
  return createHash("sha256")
    .update(JSON.stringify(relevant))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Apply the company preference bonus to a raw component total.
 * `preference` is -2..+2; the bonus scales linearly and the result is clamped
 * to 0..100.
 */
export function applyCompanyPreference(
  rawTotal: number,
  preference: number,
  weights: ScoringWeights,
): number {
  const clampedPreference = Math.max(-2, Math.min(2, preference));
  const adjustment = (clampedPreference / 2) * weights.companyPreferenceBonus;
  return Math.max(0, Math.min(100, Math.round(rawTotal + adjustment)));
}

/** Parse stored settings JSON, falling back to defaults on anything invalid. */
export function parseWeights(value: unknown): ScoringWeights {
  const result = ScoringWeightsSchema.safeParse(value);
  return result.success ? result.data : DEFAULT_WEIGHTS;
}
