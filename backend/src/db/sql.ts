/**
 * Small SQL helpers shared by more than one query. Nothing here imports the
 * pool - each takes what it needs - so any module can use them without pulling
 * in `src/config`, which exits the process when an env var is missing (the
 * route and flow tests build without a full environment).
 */

/**
 * Escapes what someone typed for LIKE / ILIKE, so a search box holding "%" or
 * "_" matches those characters rather than acting as a wildcard. Backslash is
 * LIKE's own default escape character, so no ESCAPE clause is needed.
 *
 * One copy, 2026-09-28. The queue had it right; the DNC list had a copy whose
 * template literal produced the text "${c}" in place of the escape, so its
 * escaping never worked (its check only proved "%" matched nothing, which the
 * broken version also did); and Admin > Leads did not escape at all.
 */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Anything with a `query` method: the pool, or a client inside a transaction. */
export interface Querier {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

export const DEFAULT_EXPIRY_DAYS = 7;

/**
 * `settings.expiry_days`, as a positive number of days - 7 when it is missing
 * or not a positive number.
 *
 * One reader for the four places that need it (the poller, the retry, the
 * reply flow, the expiry sweep). Two of them used the raw text, so a bad value
 * would have gone into an `interval` and failed the send's bookkeeping.
 */
export async function readExpiryDays(q: Querier): Promise<number> {
  const { rows } = await q.query(`SELECT value FROM settings WHERE key = 'expiry_days'`);
  const days = Number(rows[0]?.value);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_EXPIRY_DAYS;
}

/**
 * Whether `tz` is an IANA time zone this server knows - "America/Los_Angeles",
 * "Asia/Kolkata", "UTC". Checked with Intl, and against a strict character set
 * so the value is safe to put in SQL as a literal.
 */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The SQL for midnight today in `tz` - the viewer's day, not the database's.
 *
 * "Today" meant midnight UTC until 2026-09-28, because the database runs in
 * UTC. For a call center on US time that made today end in the afternoon: a
 * callback at 9 PM Pacific was already "tomorrow", and after 5 PM the Today tab
 * showed tomorrow's. Found in review; Jeel's choice was each viewer's own zone.
 *
 * `tz` must pass `isTimeZone` - the routes check it and refuse anything else -
 * and is checked again here, since it goes into the SQL as a literal.
 */
export function startOfTodaySql(tz = 'UTC'): string {
  if (!isTimeZone(tz)) throw new Error(`Not a time zone: ${tz}`);
  return `(date_trunc('day', now() AT TIME ZONE '${tz}') AT TIME ZONE '${tz}')`;
}
