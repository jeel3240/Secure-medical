/**
 * When Seri may book a call back, and how she says the time - Phase 7, A07,
 * docs/AI-AGENT.md section 4. Pure: no database, no clock of its own - `now`
 * is always passed in.
 *
 * Two rules. A call back falls inside the agents' hours - the robot's own
 * calling hours, the `auto_call_*` settings read by `readCallHours` - and Seri
 * says it in the lead's own time zone, worked out from the area code and
 * confirmed out loud. The time itself is an instant: 3 PM in New York and
 * 1 PM in Arizona (12 PM in summer - Arizona keeps no daylight saving) are
 * the same moment, stored once.
 */

import { insideCallHours, type CallHours, type Weekday } from '../core/auto-dial';
import { isTimeZone } from '../db/sql';

/** A call back is at least this far ahead: a real time, not "now". */
export const MIN_AHEAD_MINUTES = 15;
/** ...and at most this far. */
export const MAX_AHEAD_DAYS = 14;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// ---------------------------------------------------------------------------
// The lead's time zone, from the area code

/** Where the hours are kept, and what an unknown area code gets: Seri asks. */
export const FALLBACK_ZONE = 'America/Phoenix';

/**
 * US area codes by time zone. An area code that spans two zones is listed
 * under the one most of its people are in - 850 under Central (Pensacola,
 * Panama City; Tallahassee is Eastern), 208 under Mountain (Boise; the
 * panhandle is Pacific) - and Seri's "your time" confirmation catches the
 * rest. A code not listed, or added after this list, is unknown.
 */
export const AREA_CODES: Readonly<Record<string, string>> = {
  'America/New_York': [
    '203 475 860 959', // Connecticut
    '302', // Delaware
    '202 771', // DC
    '239 305 321 352 386 407 561 656 689 727 754 772 786 813 863 904 941 954', // Florida, but the panhandle
    '229 404 470 478 678 706 762 770 912 943', // Georgia
    '260 317 463 574 765 812 930', // Indiana, but the north-west
    '502 606 859', // Kentucky, the east
    '207', // Maine
    '227 240 301 410 443 667', // Maryland
    '339 351 413 508 617 774 781 857 978', // Massachusetts
    '231 248 269 313 517 586 616 679 734 810 906 947 989', // Michigan
    '603', // New Hampshire
    '201 551 609 640 732 848 856 862 908 973', // New Jersey
    '212 315 332 347 363 516 518 585 607 631 646 680 716 718 838 845 914 917 929 934', // New York
    '252 336 704 743 828 910 919 980 984', // North Carolina
    '216 220 234 326 330 380 419 436 440 513 567 614 740 937', // Ohio
    '215 223 267 272 412 445 484 570 610 717 724 814 835 878', // Pennsylvania
    '401', // Rhode Island
    '803 839 843 854 864', // South Carolina
    '423 865', // Tennessee, the east
    '802', // Vermont
    '276 434 540 571 686 703 757 804 826', // Virginia
    '304 681', // West Virginia
  ].join(' '),
  'America/Chicago': [
    '205 251 256 334 659 938', // Alabama
    '327 479 501 870', // Arkansas
    '448 850', // Florida, the panhandle
    '217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 872', // Illinois
    '219', // Indiana, the north-west
    '319 515 563 641 712', // Iowa
    '316 620 785 913', // Kansas
    '270 364', // Kentucky, the west
    '225 318 337 504 985', // Louisiana
    '218 320 507 612 651 763 952', // Minnesota
    '228 601 662 769', // Mississippi
    '314 417 557 573 636 660 816', // Missouri
    '308 402 531', // Nebraska
    '701', // North Dakota
    '405 539 572 580 918', // Oklahoma
    '605', // South Dakota
    '615 629 731 901 931', // Tennessee, but the east
    '210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979', // Texas, but El Paso
    '262 274 353 414 534 608 715 920', // Wisconsin
  ].join(' '),
  'America/Denver': [
    '303 719 720 970 983', // Colorado
    '208 986', // Idaho
    '406', // Montana
    '505 575', // New Mexico
    '915', // Texas, El Paso
    '385 435 801', // Utah
    '307', // Wyoming
  ].join(' '),
  'America/Phoenix': '480 520 602 623 928', // Arizona - no daylight saving
  'America/Los_Angeles': [
    '209 213 279 310 323 341 350 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951', // California
    '702 725 775', // Nevada
    '458 503 541 971', // Oregon
    '206 253 360 425 509 564', // Washington
  ].join(' '),
  'America/Anchorage': '907',
  'Pacific/Honolulu': '808',
  'America/Puerto_Rico': '340 787 939', // Puerto Rico, the Virgin Islands
  'Pacific/Guam': '671',
  'Pacific/Saipan': '670',
  'Pacific/Pago_Pago': '684',
};

const ZONE_BY_AREA_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(AREA_CODES).flatMap(([zone, codes]) => codes.split(' ').map((code) => [code, zone] as const))
);

export interface LeadZone {
  zone: string;
  /** False when the area code told us nothing: the zone is Arizona's, and Seri asks. */
  known: boolean;
}

/** The lead's time zone from their phone, E.164: "+14805551234" -> Arizona. */
export function leadTimeZone(phone: string): LeadZone {
  const match = /^\+1(\d{3})\d{7}$/.exec(phone.trim());
  const zone = match ? ZONE_BY_AREA_CODE.get(match[1]) : undefined;
  return zone ? { zone, known: true } : { zone: FALLBACK_ZONE, known: false };
}

// ---------------------------------------------------------------------------
// Wall clocks and instants

interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

interface LocalTime extends LocalDate {
  /** Minutes after midnight. */
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** What a wall clock in `zone` reads at `instant`. */
function localTime(instant: number, zone: string): LocalTime {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    formatters.set(zone, format);
  }
  const parts = format.formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day'), minute: part('hour') * 60 + part('minute') };
}

/** How far `zone` is ahead of UTC at `instant`, to the minute. */
function offset(instant: number, zone: string): number {
  const t = localTime(instant, zone);
  return Date.UTC(t.year, t.month - 1, t.day, 0, t.minute) - Math.floor(instant / MINUTE) * MINUTE;
}

/**
 * The instant a wall clock in `zone` reads `time`. A time the clocks skip
 * (2:30 AM the night they go forward) comes out an hour off - never inside
 * the agents' hours, so it is refused either way.
 */
function instantAt(time: LocalTime, zone: string): number {
  const asUtc = Date.UTC(time.year, time.month - 1, time.day, 0, time.minute);
  const first = asUtc - offset(asUtc, zone);
  return asUtc - offset(first, zone);
}

/** The calendar day `days` after `date`. */
function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function weekday(date: LocalDate): Weekday {
  return WEEKDAYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()];
}

/**
 * "2026-11-12T15:00" read as a wall clock in `zone` - how Seri gives a time
 * (A06). Null for anything that is not a real date and time, or not a zone.
 */
export function atLocalTime(local: string, zone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00)?$/.exec(local.trim());
  if (!match || !isTimeZone(zone)) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const real = addDays({ year, month, day }, 0);
  if (real.year !== year || real.month !== month || real.day !== day || hour > 23 || minute > 59) return null;
  return new Date(instantAt({ year, month, day, minute: hour * 60 + minute }, zone));
}

// ---------------------------------------------------------------------------
// The check

export type CallbackRefusal =
  | 'past' // before now
  | 'too_soon' // less than MIN_AHEAD_MINUTES away
  | 'too_far' // more than MAX_AHEAD_DAYS away
  | 'outside_hours'; // not one of the days, or not inside the hours

export type CallbackCheck =
  | { ok: true }
  | {
      ok: false;
      why: CallbackRefusal;
      /** The nearest time that would be accepted, for Seri to offer. Null only when the settings allow none. */
      offer: Date | null;
    };

/**
 * Whether a call back may be booked for `when`: in the future by at least
 * `MIN_AHEAD_MINUTES`, within `MAX_AHEAD_DAYS`, and inside the agents' hours.
 *
 * Refused, it says why and offers the nearest time that would do, as a
 * salesperson would:
 * - a day with no hours (a weekend) - the same time, the lead's own clock, on
 *   the next day with hours: Saturday at 3 becomes Monday at 3;
 * - a time outside the hours - their next opening: 8 PM becomes tomorrow at
 *   11 Arizona time, 8 AM today's 11;
 * - past, or too soon - the first quarter hour far enough ahead;
 * - too far ahead - the same time on the last day with hours in reach.
 */
export function checkCallbackTime(when: Date, leadZone: string, hours: CallHours, now: Date): CallbackCheck {
  const at = when.getTime();
  const earliest = now.getTime() + MIN_AHEAD_MINUTES * MINUTE;
  const latest = now.getTime() + MAX_AHEAD_DAYS * DAY;
  const allowed = (t: number) => t >= earliest && t <= latest && insideCallHours(new Date(t), hours);

  let why: CallbackRefusal;
  if (at < now.getTime()) why = 'past';
  else if (at < earliest) why = 'too_soon';
  else if (at > latest) why = 'too_far';
  else if (!insideCallHours(when, hours)) why = 'outside_hours';
  else return { ok: true };

  // The time asked for, on the lead's own clock, on the day `shift` days from `day`'s.
  const asked = localTime(at, leadZone).minute;
  const askedTimeOn = (day: number, shift: number) =>
    instantAt({ ...addDays(localTime(day, leadZone), shift), minute: asked }, leadZone);
  const window = Array.from({ length: MAX_AHEAD_DAYS + 1 }, (_, d) => d);
  const nextOpening = (from: number) => openings(from, hours, 1).find((t) => t >= from);
  const lastOpening = (until: number) => openings(until, hours, -1).find((t) => t <= until);

  let candidates: Array<number | undefined>;
  if (why === 'past' || why === 'too_soon') {
    const quarter = Math.ceil(earliest / (15 * MINUTE)) * 15 * MINUTE;
    candidates = [quarter, nextOpening(quarter)];
  } else if (why === 'too_far') {
    candidates = [...window.map((d) => askedTimeOn(latest, -d)), lastOpening(latest)];
  } else {
    const minute = localTime(at, hours.timeZone).minute;
    const timeInHours = minute >= hours.startMinute && minute < hours.endMinute;
    candidates = timeInHours
      ? [...window.slice(1).map((d) => askedTimeOn(at, d)), nextOpening(at), lastOpening(latest)]
      : [nextOpening(at), lastOpening(latest)];
  }
  const offer = candidates.find((t): t is number => t !== undefined && allowed(t));
  return { ok: false, why, offer: offer === undefined ? null : new Date(offer) };
}

/**
 * The openings of the hours - the start of each day that has hours - from the
 * day `from` falls on, going forward (`step` 1) or back (-1), far enough to
 * cover the booking window.
 */
function openings(from: number, hours: CallHours, step: 1 | -1): number[] {
  const first = localTime(from, hours.timeZone);
  const found: number[] = [];
  for (let d = 0; d <= MAX_AHEAD_DAYS + 7; d++) {
    const date = addDays(first, d * step);
    if (hours.days.has(weekday(date))) found.push(instantAt({ ...date, minute: hours.startMinute }, hours.timeZone));
  }
  return found;
}

// ---------------------------------------------------------------------------
// Saying it

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * How Seri says a time, on the lead's own clock: "today at 3 PM your time",
 * "tomorrow at 11:30 AM your time", "Thursday at 3 PM your time" within the
 * week, and with the date beyond it - "Thursday, November 19 at 3 PM your
 * time" - so two Thursdays are never mixed up.
 */
export function spokenTime(when: Date, leadZone: string, now: Date): string {
  const t = localTime(when.getTime(), leadZone);
  const today = localTime(now.getTime(), leadZone);
  const daysAway = Math.round(
    (Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(today.year, today.month - 1, today.day)) / DAY
  );
  const name = DAY_NAMES[new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay()];
  const day =
    daysAway === 0
      ? 'today'
      : daysAway === 1
        ? 'tomorrow'
        : daysAway > 1 && daysAway < 7
          ? name
          : `${name}, ${MONTH_NAMES[t.month - 1]} ${t.day}`;

  return `${day} at ${spokenClock(when, leadZone)} your time`;
}

/** What a clock in `zone` reads at `when`, as said: "3 PM", "11:30 AM", "12 PM" for noon. */
export function spokenClock(when: Date, zone: string): string {
  const minute = localTime(when.getTime(), zone).minute;
  const hour24 = Math.floor(minute / 60);
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const clock = minute % 60 === 0 ? `${hour}` : `${hour}:${String(minute % 60).padStart(2, '0')}`;
  return `${clock} ${hour24 < 12 ? 'AM' : 'PM'}`;
}
