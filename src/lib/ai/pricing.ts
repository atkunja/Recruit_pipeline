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
