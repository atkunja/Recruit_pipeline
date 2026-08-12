import "server-only";
import postgres from "postgres";

/**
 * Postgres client.
 *
 * Points at Supabase's *session* pooler (port 5432), not the transaction
 * pooler (6543). Transaction mode multiplexes clients onto shared backends, so
 * `SET` state leaks between them and a long-lived client eventually queues
 * queries forever with no error surfaced anywhere — the app just spins. Session
 * mode gives a dedicated backend. `prepare: false` is kept because it is
 * correct under either mode.
 */

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { __sql?: Sql };

/**
 * Connection string, tolerating absence at import time.
 *
 * `next build` imports every module to collect page metadata, and a machine
 * running a build need not have database credentials. Rather than deferring
 * construction (see the note on `sql` below for why that went badly), we
 * construct against an unroutable placeholder. No socket is opened until a
 * query runs, and a query that does run without credentials fails quickly with
 * a connection error instead of hanging.
 */
function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (url !== undefined && url.length > 0) return url;
  return "postgresql://unset:unset@127.0.0.1:1/unset";
}

function create(): Sql {
  return postgres(connectionString(), {
    prepare: false,
    // snake_case in Postgres, camelCase in TypeScript, translated in both
    // directions — including for the `sql(object)` insert/update helper.
    transform: postgres.camel,

    // Parse bigint (int8) as a JS number.
    //
    // postgres.js returns int8 as a *string* by default to protect values past
    // 2^53. Every id in this schema is a generated identity column that will
    // never come close, and every type in src/lib/types.ts declares them as
    // `number` — so the default silently made runtime disagree with the types.
    //
    // That mismatch was not theoretical: resume tailoring compared model-supplied
    // numeric ids against a Set of strings, matched nothing, and produced a
    // resume with no experience on it that still passed every fabrication check.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number | string) => String(value),
        parse: (value: string) => Number(value),
      },
    },

    // Pool size.
    //
    // This was briefly 1, to contain a connection leak caused by a lazy Proxy
    // rebuilding clients (since removed). One connection serializes everything:
    // ingesting 366 postings at ~5 queries each through a single connection was
    // the reason a discovery run spent its entire window fetching boards and
    // never reached scoring.
    //
    // Session-mode pooling gives each connection a dedicated backend, and
    // Supabase allows far more than this, so a modest pool is both safe and
    // dramatically faster.
    max: 10,

    // Hand the connection back quickly so an idle page view doesn't hold a
    // slot, and recycle periodically so a half-dead socket can't persist.
    idle_timeout: 10,
    max_lifetime: 60 * 10,
    connect_timeout: 10,

    // Fail loudly rather than hanging. Without this a stuck query blocks the
    // request forever and the UI just shows a spinner with no error anywhere.
    connection: { statement_timeout: 20_000 },

    onnotice: () => {},
  });
}

/**
 * The query client.
 *
 * A plain instance, created once at module load and cached on `globalThis` so
 * dev hot-reloads reuse it.
 *
 * This was briefly a Proxy that deferred construction to the first query, so
 * that `next build` could import the module without credentials. That was a
 * mistake worth recording: under Next's server runtime the `globalThis` cache
 * did not hold across module graphs, so the proxy rebuilt a `postgres()`
 * client on property access. That exhausted Supabase's pooler slots and every
 * query hung forever with no error — the worst possible failure mode.
 *
 * `postgres()` does not open a socket until the first query, so constructing
 * eagerly costs nothing and needs no live database.
 */
export const sql: Sql = globalForDb.__sql ?? create();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sql = sql;
}

/** The transaction-scoped client handed to `transaction()` callbacks. */
export type Tx = postgres.TransactionSql<Record<string, unknown>>;

/**
 * Run a set of statements inside a transaction.
 * Thin wrapper so call sites don't import `postgres` types directly.
 */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin((tx) => fn(tx as Tx)) as Promise<T>;
}

/**
 * Cast a plain object to the shape `sql.json()` accepts.
 * Our domain types are JSON-serializable but lack the index signature the
 * driver's `JSONValue` requires, and adding one to every type would weaken it.
 */
export function json(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue;
}

/** Narrow a query result to its first row, or null when empty. */
export function one<T>(rows: readonly T[]): T | null {
  return rows.length > 0 ? (rows[0] as T) : null;
}

/** Narrow a query result to its first row, throwing when empty. */
export function oneOrThrow<T>(rows: readonly T[], what = "row"): T {
  const row = one(rows);
  if (row === null) throw new Error(`Expected exactly one ${what}, got none`);
  return row;
}
