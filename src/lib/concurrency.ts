/**
 * Bounded-concurrency helpers.
 *
 * Discovery is almost entirely waiting — on job boards, on posting pages, on
 * the model. Doing that work one item at a time is what made a run spend its
 * whole window fetching boards and never reach scoring. These run a fixed
 * number of items at once, respect a deadline, and never reject: a failed item
 * yields its error rather than tearing down the batch.
 */

export interface MapOptions {
  /** Stop starting new work once this timestamp passes. */
  deadline?: number;
  signal?: AbortSignal;
  /** Called after each item settles, for progress reporting. */
  onSettled?: (done: number, total: number) => void;
}

export interface Settled<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
  /** True when the item was never started because time ran out. */
  skipped?: boolean;
}

/**
 * Run `fn` over `items` with at most `limit` in flight.
 *
 * Results are returned in input order. Work already in flight is allowed to
 * finish when the deadline passes; only *new* work is skipped, so a run winds
 * down cleanly instead of abandoning half-written state.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  options: MapOptions = {},
): Promise<Settled<R>[]> {
  const results: Settled<R>[] = new Array<Settled<R>>(items.length);
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  let done = 0;

  const outOfTime = (): boolean =>
    (options.deadline !== undefined && Date.now() >= options.deadline) ||
    options.signal?.aborted === true;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;

      if (outOfTime()) {
        results[index] = { ok: false, skipped: true };
        continue;
      }

      const item = items[index] as T;
      try {
        results[index] = { ok: true, value: await fn(item, index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
      done += 1;
      options.onSettled?.(done, items.length);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

/**
 * Split a total time budget into ordered phases.
 *
 * Each phase gets a deadline, and any time a phase leaves unused rolls into the
 * next one. This is what stops the board-fetching phase from eating the whole
 * window and leaving nothing for the step that actually produces value.
 */
export function phaseDeadlines(
  totalMs: number,
  shares: readonly number[],
  startedAt = Date.now(),
): number[] {
  const sum = shares.reduce((total, share) => total + share, 0) || 1;
  const deadlines: number[] = [];
  let elapsed = 0;
  for (const share of shares) {
    elapsed += (share / sum) * totalMs;
    deadlines.push(startedAt + elapsed);
  }
  return deadlines;
}
