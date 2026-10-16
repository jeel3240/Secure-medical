/**
 * The arguments of `npm run openers:send-waiting` - pure, so they are tested
 * without a database. The command itself is `worker/send-waiting-openers.ts`;
 * `POLLER.md`, "Resending after an outage", is how and when to run it.
 *
 *   --from 2026-10-14            leads that arrived from then  (required)
 *   --to 2026-10-16T08:00        ... and before then           (default: now)
 *   --every 30                   seconds between texts         (default 30, at least 10)
 *   --limit 5                    stop after this many texts    (default: all)
 *   --dry-run                    list them, send nothing
 *
 * **A date or time without an offset is Arizona time.** The client and the
 * people running this are in Arizona, and Phoenix keeps the same offset all
 * year - no daylight saving - so `-07:00` is always right and no time-zone
 * library is needed. A time with `Z` or an offset is taken as written.
 */

export interface ResendOptions {
  /** Leads that arrived at or after this... */
  from: Date;
  /** ...and before this. */
  to: Date;
  /** The pause between two texts. */
  everyMs: number;
  /** Stop after this many texts have gone out. Null: send them all. */
  limit: number | null;
  dryRun: boolean;
}

export type ParsedResendArgs =
  | { ok: true; options: ResendOptions }
  | { ok: false; error: string }
  | { ok: false; help: true };

export const USAGE = `Usage: npm run openers:send-waiting -- --from <when> [--to <when>] [--every <seconds>] [--limit <n>] [--dry-run]

  --from     leads that arrived from this time (required)
  --to       ... and before this time (default: now)
  --every    seconds between two texts (default 30, at least 10; "2m" for minutes)
  --limit    stop after this many texts have gone out
  --dry-run  list the leads and send nothing

  <when> is a date (2026-10-14) or a date and time (2026-10-14T09:30), Arizona
  time - or any time with an offset (2026-10-14T16:30Z).`;

/** Phoenix is UTC-7 all year: Arizona does not observe daylight saving. */
export const ARIZONA_OFFSET_MINUTES = -7 * 60;

export const DEFAULT_EVERY_SECONDS = 30;

/**
 * Never faster than this, whatever is typed. Sending a few hundred of the same
 * text back to back is how a sender gets screened by the carriers; this is a
 * resend, not a race.
 */
export const MIN_EVERY_SECONDS = 10;

const WHEN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:(Z)|([+-])(\d{2}):(\d{2}))?)?$/;

/**
 * A date or a date and time, checked part by part. JavaScript's own parser
 * accepts "2026-02-30" and quietly makes it 2 March; a window that silently
 * moves is worse than a refusal.
 */
export function parseWhen(text: string): Date | null {
  const m = WHEN.exec(text);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', zulu, sign, oh, om] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = ARIZONA_OFFSET_MINUTES;
  if (zulu) {
    offsetMinutes = 0;
  } else if (sign) {
    const hours = Number(oh);
    const minutes = Number(om);
    if (hours > 14 || minutes > 59) return null;
    offsetMinutes = (sign === '-' ? -1 : 1) * (hours * 60 + minutes);
  }

  // The wall-clock time in that offset, moved to UTC.
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000);
}

/** "30", "30s" or "2m", as milliseconds. */
function parseEvery(text: string): number | null {
  const m = /^(\d+)([sm]?)$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * (m[2] === 'm' ? 60_000 : 1000);
}

/**
 * Reads the command line. `now` is the default `--to`, passed in so the tests
 * do not depend on the clock.
 */
export function parseResendArgs(argv: readonly string[], now: Date): ParsedResendArgs {
  let from: Date | null = null;
  let to: Date | null = null;
  let everyMs = DEFAULT_EVERY_SECONDS * 1000;
  let limit: number | null = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];

    if (flag === '--help' || flag === '-h') return { ok: false, help: true };
    if (flag === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!['--from', '--to', '--every', '--limit'].includes(flag)) {
      return { ok: false, error: `Unknown argument: ${flag}` };
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, error: `${flag} needs a value.` };
    }
    i++;

    switch (flag) {
      case '--from':
      case '--to': {
        const when = parseWhen(value);
        if (!when) {
          return { ok: false, error: `${flag} ${value} is not a date like 2026-10-14 or 2026-10-14T09:30.` };
        }
        if (flag === '--from') from = when;
        else to = when;
        break;
      }
      case '--every': {
        const ms = parseEvery(value);
        if (ms === null) return { ok: false, error: `--every ${value} is not a number of seconds, like 30 or 2m.` };
        if (ms < MIN_EVERY_SECONDS * 1000) {
          return { ok: false, error: `--every must be at least ${MIN_EVERY_SECONDS} seconds.` };
        }
        everyMs = ms;
        break;
      }
      case '--limit': {
        if (!/^\d+$/.test(value) || Number(value) < 1) {
          return { ok: false, error: `--limit ${value} is not a whole number of at least 1.` };
        }
        limit = Number(value);
        break;
      }
    }
  }

  if (!from) return { ok: false, error: '--from is required: when did the first lead that is still waiting arrive?' };
  const until = to ?? now;
  if (from >= until) return { ok: false, error: '--from must be before --to.' };

  return { ok: true, options: { from, to: until, everyMs, limit, dryRun } };
}

const ARIZONA_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Phoenix',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Oct 14, 2026, 9:12 AM" - the times the command prints, in Arizona time. */
export function arizonaTime(when: Date): string {
  return ARIZONA_TIME.format(when);
}
