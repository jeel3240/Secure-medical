/**
 * When the robot places its calls, and how many at once - T20,
 * docs/AUTO-CALLS.md "When a lead is called" and "Traffic". Pure: the worker's
 * job (`worker/auto-calls.ts`) reads the settings and the database, and asks
 * these.
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** The `auto_call_*` settings a call's timing reads, parsed. */
export interface CallHours {
  /** Minutes after midnight, local: from (inclusive), to (exclusive). */
  startMinute: number;
  endMinute: number;
  /** IANA - the hours are this zone's. */
  timeZone: string;
  days: ReadonlySet<Weekday>;
  /** How long after the first text a lead who has not replied is called. */
  waitMinutes: number;
}

/** Migration 015's values: 11am-5pm Arizona time, Monday to Friday, an hour after the first text. */
export const DEFAULT_CALL_HOURS: CallHours = {
  startMinute: 11 * 60,
  endMinute: 17 * 60,
  timeZone: 'America/Phoenix',
  days: new Set<Weekday>(['mon', 'tue', 'wed', 'thu', 'fri']),
  waitMinutes: 60,
};

/** "11:00" -> 660. Null for anything that is not a time of day. */
export function parseClock(raw: string | undefined): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((raw ?? '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** "mon,tue,wed" -> those days. Null when empty, or when any entry is not a day. */
export function parseDays(raw: string | undefined): Set<Weekday> | null {
  const entries = (raw ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0 || !entries.every((d) => (WEEKDAYS as readonly string[]).includes(d))) return null;
  return new Set(entries as Weekday[]);
}

/**
 * Whether `now` is inside the calling hours, in their own time zone: one of
 * the days, at or after the start, before the end.
 */
export function insideCallHours(now: Date, hours: CallHours): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: hours.timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = part('weekday').toLowerCase() as Weekday;
  const minute = Number(part('hour')) * 60 + Number(part('minute'));
  return hours.days.has(day) && minute >= hours.startMinute && minute < hours.endMinute;
}

/** How many calls the robot may place now, from who can take a "yes" - `callsToPlace`. */
export interface DialRoom {
  /** People free to take a transfer (`FREE_SQL`). */
  free: number;
  /** Its own calls still going with nobody on them yet - each may need one of those people. */
  underway: number;
  /** A lead is waiting on hold: everyone free is spoken for (T16). */
  onHold: boolean;
  /**
   * Its calls placed a while ago that Twilio has said nothing about since - no
   * end, no verdict: Twilio's reports are not reaching us (T20 review).
   */
  silent: number;
  /** A call script is active - with none, a call has nothing to say. */
  scripted: boolean;
}

/**
 * How many calls to place now - "Traffic": never more going at once than
 * there are people free to take a "yes", none while a lead waits on hold, and
 * none when nobody is free. None either while Twilio's reports are not
 * reaching us - each call would reach a lead as Twilio's error, and use up the
 * one call they get - nor with no script to say.
 */
export function callsToPlace(room: DialRoom): number {
  if (room.onHold || room.silent > 0 || !room.scripted) return 0;
  return Math.max(0, room.free - room.underway);
}
