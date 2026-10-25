/**
 * The automated call's settings in words, for Admin > Configuration - T24.
 * Pure. The values come from the server as the robot reads them
 * (`CallSettings`, backend/src/db/admin-config.ts).
 */

const DAY_NAMES: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
const WEEK = Object.keys(DAY_NAMES);

/** Minutes after midnight as a clock: 660 -> "11:00 AM", 1020 -> "5:00 PM". */
export function clockText(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = String(minute % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Monday to Friday" for days in a row; otherwise each one: "Monday, Wednesday, Friday". */
export function daysText(days: readonly string[]): string {
  const known = WEEK.filter((d) => days.includes(d));
  if (known.length === 0) return '-';
  if (known.length === 1) return DAY_NAMES[known[0]];
  const first = WEEK.indexOf(known[0]);
  const inARow = known.every((d, i) => WEEK.indexOf(d) === first + i);
  return inARow
    ? `${DAY_NAMES[known[0]]} to ${DAY_NAMES[known[known.length - 1]]}`
    : known.map((d) => DAY_NAMES[d]).join(', ');
}

/** 60 -> "1 hour", 120 -> "2 hours", 90 -> "90 minutes", 1 -> "1 minute". */
export function minutesText(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
