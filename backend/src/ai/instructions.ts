/**
 * What Seri is told about the call - Phase 7, A04, docs/AI-AGENT.md sections
 * 3 and 12. Pure.
 *
 * The call's own details for the speak step (`callPart`, speak.ts): the
 * greeting, the lead's name, the time, the lead's zone, the agents' hours and
 * the next days with hours. Also the greeting Twilio says (`welcomeGreeting`),
 * the lead's name made fit to say (`cleanFirstName`), and who could take the
 * call (`WhoIsThere`), noted on each of the lead's turns for the brain.
 *
 * Until 2026-11-19 this also wrote today's brain's whole instructions - who
 * she is, the rules, every answer, her five actions - asked of OpenAI in one
 * request a reply. The new brain (section 12) replaced it, and it was removed.
 */

import { formatClock, WEEKDAYS, type CallHours, type Weekday } from '../core/auto-dial';
import { atLocalTime, FALLBACK_ZONE_SAID, leadTimeZone, spokenClock } from './callback-time';

/** What the call's own details are worked out from. */
export interface CallDetails {
  lead: { firstName: string | null; phone: string };
  now: Date;
  /** The agents' hours - `readCallHours`. Call backs are booked inside them. */
  hours: CallHours;
}

const CALL_TITLE = 'This call';
/** Where the call's own details begin: everything before it is the same on every call. */
export const CALL_HEADING = `## ${CALL_TITLE}`;

// ---------------------------------------------------------------------------
// Who is there, noted with each turn

/**
 * Who could take the call right now - section 3, worked out before each of
 * Seri's replies: someone free (`FREE_SQL`), nobody free but someone coming
 * (on a call, writing its note, ringing with another lead - T17), or nobody.
 */
export type WhoIsThere = 'free' | 'coming' | 'nobody';

const WHO_IS_THERE: Record<WhoIsThere, string> = {
  free: 'someone free',
  coming: 'someone coming',
  nobody: 'nobody',
};

/** The note the call puts before each thing the lead says (A11) - the brain reads who is there from it (brain.ts). */
export function whoIsThereNote(who: WhoIsThere): string {
  return `[Who is there: ${WHO_IS_THERE[who]}]`;
}

// ---------------------------------------------------------------------------
// The lead's name, and the greeting

/**
 * A first name fit to be said and written into the speak step's details: letters,
 * with spaces, hyphens, apostrophes and dots between, at most 30 long. All
 * capitals or all small letters are made "John"; anything else - "TEST123",
 * a sentence pasted into a form - is no name at all.
 */
export function cleanFirstName(raw: string | null | undefined): string | null {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!/^\p{L}[\p{L}\p{M}' .-]{0,29}$/u.test(name) || !/\p{L}$/u.test(name)) return null;
  if (name !== name.toUpperCase() && name !== name.toLowerCase()) return name;
  return name.toLowerCase().replace(/(^|[ '-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/**
 * The first thing the lead hears, said by Twilio the moment they pick up
 * (`welcomeGreeting`, A13): "Hi, is this John?", or "Hi there!" with no name.
 */
export function welcomeGreeting(firstName: string | null): string {
  const name = cleanFirstName(firstName);
  return name ? `Hi, is this ${name}?` : 'Hi there!';
}

// ---------------------------------------------------------------------------
// The call's own details

/** The call's own details: the greeting, the name, the time, the lead's zone, the hours - also the speak step's (A29). */
export function callPart({ lead, now, hours }: CallDetails): string {
  const name = cleanFirstName(lead.firstName);
  const { zone, known } = leadTimeZone(lead.phone);
  const today = dateIn(now, hours.timeZone);
  // Always a time: `clock` writes one, and `readCallHours` checked the zone.
  const at = (minute: number) => atLocalTime(`${today}T${formatClock(minute)}`, hours.timeZone) as Date;
  const open = at(hours.startMinute);
  const close = at(hours.endMinute);
  const openToday = hours.days.has(weekdayIn(now, hours.timeZone));
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return [
    CALL_HEADING,
    `- The greeting you have already said: "${welcomeGreeting(lead.firstName)}"`,
    name
      ? `- The lead's first name: ${name}. Use it once or twice in the call, not in every sentence.`
      : '- We don\'t have the lead\'s name. Don\'t guess one.',
    `- Now: ${longDate(now, hours.timeZone)} ${zoneName(hours.timeZone)} (${today}); tomorrow is ${longDay(tomorrow, hours.timeZone)} (${dateIn(tomorrow, hours.timeZone)}).`,
    known
      ? `- The lead's time zone, from their area code: ${zoneName(zone)} (${zone}). For them it is ${longDate(now, zone)} (${dateIn(now, zone)}); tomorrow is ${longDay(tomorrow, zone)} (${dateIn(tomorrow, zone)}).`
      : `- We can't tell the lead's time zone from their number: every call back time is ${zoneName(zone)} (${zone}), and said so - "${FALLBACK_ZONE_SAID}", never "your time".`,
    `- Agent hours, for call backs: ${dayList(hours.days)}${closedDays(hours.days)}, ${spokenClock(open, hours.timeZone)} to ${spokenClock(close, hours.timeZone)} ${zoneName(hours.timeZone)}${
      !openToday
        ? '. Today has none.'
        : known && zone !== hours.timeZone
          ? ` - today, ${spokenClock(open, zone)} to ${spokenClock(close, zone)} the lead's time.`
          : '.'
    }`,
    nextDays(now, close, hours),
  ].join('\n');
}

/**
 * The next days a call back can be on, worked out for her: on call 93, a
 * Friday afternoon, she agreed "tomorrow at 2 PM" - a Saturday - though told
 * both "tomorrow is Saturday" and "Monday to Friday" (A21). Today while its
 * hours last, then the next three days with hours; and a day with none said
 * plainly when it is tomorrow, the one a lead asks for most.
 */
function nextDays(now: Date, close: Date, hours: CallHours): string {
  const zone = hours.timeZone;
  const DAY = 24 * 60 * 60 * 1000;
  const open: string[] = [];
  if (hours.days.has(weekdayIn(now, zone)) && now < close) open.push(`today, until ${spokenClock(close, zone)}`);
  for (let d = 1; d <= 14 && open.length < 4; d++) {
    const day = new Date(now.getTime() + d * DAY);
    if (hours.days.has(weekdayIn(day, zone))) open.push(`${d === 1 ? 'tomorrow, ' : ''}${longDay(day, zone)}`);
  }
  const tomorrow = new Date(now.getTime() + DAY);
  const weekend = ['sat', 'sun'].includes(weekdayIn(tomorrow, zone));
  const closedTomorrow = hours.days.has(weekdayIn(tomorrow, zone))
    ? ''
    : ` Tomorrow, ${longDay(tomorrow, zone)}, has none${weekend ? ' - a weekend, when our team does not work' : ''}: never agree a call back then.`;
  return `- The next days with agent hours: ${open.length ? open.join('; ') : 'none in the next two weeks'}.${closedTomorrow}`;
}

const ZONE_NAMES: Record<string, string> = {
  'America/New_York': 'Eastern time',
  'America/Chicago': 'Central time',
  'America/Denver': 'Mountain time',
  'America/Phoenix': 'Arizona time',
  'America/Los_Angeles': 'Pacific time',
  'America/Anchorage': 'Alaska time',
  'Pacific/Honolulu': 'Hawaii time',
  'America/Puerto_Rico': 'Atlantic time',
  'Pacific/Guam': 'Guam time',
  'Pacific/Saipan': 'Northern Mariana Islands time',
  'Pacific/Pago_Pago': 'Samoa time',
};

function zoneName(zone: string): string {
  return ZONE_NAMES[zone] ?? `${zone} time`;
}

/** "Wednesday, November 11, 2026 at 12:00 PM" in `zone`. */
function longDate(when: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(when);
}

/** "Thursday, November 12" in `zone`. */
function longDay(when: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' }).format(when);
}

/** "2026-11-11" in `zone` - the form `book_callback` takes its date in (A06). */
function dateIn(when: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
}

const DAY_NAMES: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function weekdayIn(when: Date, zone: string): Weekday {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(when).toLowerCase() as Weekday;
}

/** "Monday to Friday" for a run of three days or more, else "Monday, Wednesday and Friday". */
function dayList(days: ReadonlySet<Weekday>): string {
  const listed = WEEKDAYS.filter((d) => days.has(d));
  const first = WEEKDAYS.indexOf(listed[0]);
  const run = listed.length >= 3 && listed.every((d, i) => WEEKDAYS.indexOf(d) === first + i);
  if (run) return `${DAY_NAMES[listed[0]]} to ${DAY_NAMES[listed[listed.length - 1]]}`;
  const names = listed.map((d) => DAY_NAMES[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? 'no days');
}

/** " - never Saturday or Sunday": the days with no hours, said plainly, since a lead asks for them. */
function closedDays(days: ReadonlySet<Weekday>): string {
  const closed = WEEKDAYS.filter((d) => !days.has(d)).map((d) => DAY_NAMES[d]);
  if (closed.length === 0) return '';
  return ` - never ${closed.length > 1 ? `${closed.slice(0, -1).join(', ')} or ${closed[closed.length - 1]}` : closed[0]}`;
}
