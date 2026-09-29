import { isTimeZone } from '../db/sql';
import { HttpError } from './http';

/**
 * Request parsing shared by more than one endpoint - one place, so the same
 * filter behaves the same everywhere. Until 2026-09-28 the queue refused
 * an unknown time window with a 400 and Admin > Leads silently ignored it;
 * both refuse now, as the DNC list always did. A bad filter is refused rather
 * than quietly dropped, so a typo in a link shows up as an error instead of
 * the wrong list.
 */

const SINCE_HOURS: Record<string, number> = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

/** `?since=` - `1h`, `24h`, `7d`, `30d`, or `all`, empty or absent for no limit. */
export function parseSince(raw: unknown): Date | undefined {
  if (raw === undefined || raw === '' || raw === 'all') return undefined;
  const hours = typeof raw === 'string' ? SINCE_HOURS[raw] : undefined;
  if (!hours) {
    throw new HttpError(400, 'invalid_since', `Time window must be one of: ${Object.keys(SINCE_HOURS).join(', ')}, all.`);
  }
  return new Date(Date.now() - hours * 3600_000);
}

/**
 * `?tz=` - the viewer's IANA time zone, for where "today" starts. Absent means
 * UTC, so an older client still gets an answer; anything else that is not a
 * real zone is refused, like every other bad filter.
 */
export function parseTimeZone(raw: unknown): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!isTimeZone(raw)) {
    throw new HttpError(400, 'invalid_tz', 'tz must be an IANA time zone, like America/Los_Angeles.');
  }
  return raw;
}

/** `:id` in a lead's path. */
export function parseLeadId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new HttpError(400, 'invalid_lead_id', 'Lead id must be a whole number above 0.');
  }
  return id;
}

/** A comma-separated list, `?source=API,WebInterface`. Empty means no filter. */
export function parseList(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const values = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return values.length ? values : undefined;
}
