/**
 * Token pricing, in USD per million tokens.
 *
 * Used to attribute a cost to every call so the monthly guard can refuse to
 * spend past the ceiling. Prices move; when they do, edit this table. An
 * unknown model falls back to a deliberately pessimistic estimate so a typo in
 * OPENAI_MODEL_STRONG shows up as "too expensive" rather than as a silent
 * under-count.
 */

export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cached input tokens. */
  cachedInput: number;
}

const PRICES: Record<string, ModelPrice> = {
  "gpt-4.1": { input: 2.0, output: 8.0, cachedInput: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cachedInput: 0.1 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cachedInput: 0.025 },
  "gpt-4o": { input: 2.5, output: 10.0, cachedInput: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
  "gpt-5": { input: 1.25, output: 10.0, cachedInput: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2.0, cachedInput: 0.025 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cachedInput: 0.005 },

  // GPT-5.6 family (July 2026), cheapest to most capable: Luna, Terra, Sol.
  // Cached-input rates are not published separately, so they are set equal to
  // the standard input rate — that over-counts rather than under-counts, which
  // is the safe direction for the budget guard.
  "gpt-5.6-luna": { input: 1.0, output: 6.0, cachedInput: 1.0 },
  "gpt-5.6-terra": { input: 2.5, output: 15.0, cachedInput: 2.5 },
  "gpt-5.6-sol": { input: 5.0, output: 30.0, cachedInput: 5.0 },

  // Moonshot (Kimi), used via OPENAI_BASE_URL. Rounded UP from published
  // rates on purpose: over-estimating makes the budget guard stop early,
  // under-estimating lets it overspend. Third-party hosts (Groq, Together,
  // Fireworks, OpenRouter) charge more than Moonshot direct — if you use one,
  // put its rate here rather than trusting these.
  "kimi-k2": { input: 0.6, output: 2.5, cachedInput: 0.15 },
  "kimi-k2-turbo": { input: 1.2, output: 5.0, cachedInput: 0.3 },
  "kimi-latest": { input: 2.0, output: 5.0, cachedInput: 0.5 },
  "moonshot-v1-8k": { input: 0.2, output: 2.0, cachedInput: 0.2 },
  "moonshot-v1-32k": { input: 1.0, output: 3.0, cachedInput: 1.0 },
  "moonshot-v1-128k": { input: 2.0, output: 5.0, cachedInput: 2.0 },
};

/** Pessimistic stand-in for a model we have no price for. */
const UNKNOWN: ModelPrice = { input: 5.0, output: 20.0, cachedInput: 5.0 };

export function priceFor(model: string): ModelPrice {
  const exact = PRICES[model];
  if (exact) return exact;

  // API model ids often carry a date suffix, e.g. "gpt-4.1-2025-04-14".
  const base = Object.keys(PRICES)
    .filter((known) => model.startsWith(known))
    .sort((a, b) => b.length - a.length)[0];

  return base !== undefined ? (PRICES[base] ?? UNKNOWN) : UNKNOWN;
}

/** Cost of one call in USD. */
export function costOf(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens = 0,
): number {
  const price = priceFor(model);
  const uncachedPrompt = Math.max(0, promptTokens - cachedTokens);
  return (
    (uncachedPrompt * price.input +
      cachedTokens * price.cachedInput +
      completionTokens * price.output) /
    1_000_000
  );
}
