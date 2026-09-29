import { isTimeZone } from '../db/sql';
import { HttpError } from './http';

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
