/**
 * When Seri may book a call back, and how she says it - A07, AI-AGENT.md
 * section 4.
 *
 * Arizona is UTC-7 all year. New York is UTC-5 in winter and UTC-4 in summer:
 * the clocks went back on 2026-11-01 and go forward on 2027-03-14 (2026-03-08
 * the year before). 2026-11-11 is a Wednesday.
 */
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { isTimeZone } from '../db/sql';
import {
  AREA_CODES,
  atLocalTime,
  checkCallbackTime,
  FALLBACK_ZONE,
  leadTimeZone,
  MAX_AHEAD_DAYS,
  spokenTime,
} from './callback-time';

const at = (iso: string) => new Date(iso);
const NY = 'America/New_York';
const AZ = 'America/Phoenix';
// Wednesday 2026-11-11, noon in Arizona - inside the hours, as every call Seri makes is.
const NOW = at('2026-11-11T19:00:00Z');

describe('the lead\'s time zone, from the area code', () => {
  it.each([
    ['+12125551234', NY], // New York
    ['+13125551234', 'America/Chicago'], // Chicago
    ['+13035551234', 'America/Denver'], // Denver
    ['+14805551234', AZ], // Arizona
    ['+14155551234', 'America/Los_Angeles'], // San Francisco
    ['+19075551234', 'America/Anchorage'],
    ['+18085551234', 'Pacific/Honolulu'],
    ['+17875551234', 'America/Puerto_Rico'],
  ])('%s is %s', (phone, zone) => {
    expect(leadTimeZone(phone)).toEqual({ zone, known: true });
  });

  it('an area code across two zones takes the one most of its people are in', () => {
    expect(leadTimeZone('+18505551234').zone).toBe('America/Chicago'); // Florida's panhandle
    expect(leadTimeZone('+12085551234').zone).toBe('America/Denver'); // Idaho
    expect(leadTimeZone('+19155551234').zone).toBe('America/Denver'); // El Paso, not the rest of Texas
    expect(leadTimeZone('+12195551234').zone).toBe('America/Chicago'); // north-west Indiana
    expect(leadTimeZone('+18125551234').zone).toBe(NY); // the rest of southern Indiana
  });

  it('unknown - Arizona\'s zone, and Seri asks', () => {
    expect(leadTimeZone('+18005551234')).toEqual({ zone: FALLBACK_ZONE, known: false }); // toll free
    expect(leadTimeZone('+447911123456')).toEqual({ zone: FALLBACK_ZONE, known: false }); // not North America
    expect(leadTimeZone('4805551234')).toEqual({ zone: FALLBACK_ZONE, known: false }); // not E.164
    expect(FALLBACK_ZONE).toBe(AZ);
  });

  it('every area code is listed once, under a real zone', () => {
    const codes = Object.values(AREA_CODES).flatMap((list) => list.split(' '));
    expect(codes.every((code) => /^[2-9]\d\d$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    expect(Object.keys(AREA_CODES).every(isTimeZone)).toBe(true);
  });
});

describe('a wall clock read in a zone', () => {
  it('3 PM in New York is 1 PM in Arizona in winter - the same instant either way', () => {
    expect(atLocalTime('2026-11-12T15:00', NY)).toEqual(at('2026-11-12T20:00:00Z'));
    expect(atLocalTime('2026-11-12T13:00', AZ)).toEqual(at('2026-11-12T20:00:00Z'));
  });

  it('...and 12 PM in summer: Arizona keeps no daylight saving', () => {
    expect(atLocalTime('2026-07-16T15:00', NY)).toEqual(at('2026-07-16T19:00:00Z'));
    expect(atLocalTime('2026-07-16T12:00', AZ)).toEqual(at('2026-07-16T19:00:00Z'));
  });

  it('either side of the clocks changing', () => {
    expect(atLocalTime('2026-03-07T15:00', NY)).toEqual(at('2026-03-07T20:00:00Z')); // Saturday, still winter
    expect(atLocalTime('2026-03-09T15:00', NY)).toEqual(at('2026-03-09T19:00:00Z')); // Monday, summer
    expect(atLocalTime('2026-10-31T15:00', NY)).toEqual(at('2026-10-31T19:00:00Z')); // Saturday, summer
    expect(atLocalTime('2026-11-02T15:00', NY)).toEqual(at('2026-11-02T20:00:00Z')); // Monday, winter
  });

  it('seconds of :00 are fine', () => {
    expect(atLocalTime('2026-11-12T15:00:00', NY)).toEqual(at('2026-11-12T20:00:00Z'));
  });

  it.each([
    ['2026-02-30T10:00', NY], // no such day
    ['2026-11-12T24:00', NY],
    ['2026-11-12T15:60', NY],
    ['2026-11-12 15:00', NY], // not the format asked for
    ['2026-11-12T15:00Z', NY], // an instant, not a wall clock
    ['tomorrow at 3', NY],
    ['2026-11-12T15:00', 'Mars/Olympus'],
  ])('%s in %s is refused', (local, zone) => {
    expect(atLocalTime(local, zone)).toBeNull();
  });
});

describe('when a call back may be booked', () => {
  const check = (iso: string, zone = NY, now = NOW, hours = DEFAULT_CALL_HOURS) =>
    checkCallbackTime(at(iso), zone, hours, now);
  const offer = (result: ReturnType<typeof check>) => (result.ok ? 'ok' : `${result.why} ${result.offer?.toISOString()}`);
  const offered = (result: ReturnType<typeof check>) => (result.ok ? null : result.offer) as Date;

  it('inside the hours, ahead, within two weeks', () => {
    expect(check('2026-11-12T20:00:00Z')).toEqual({ ok: true }); // Thursday 3 PM New York, 1 PM Arizona
    expect(check('2026-11-12T18:00:00Z')).toEqual({ ok: true }); // Thursday 11 AM Arizona, the opening
    expect(check('2026-11-12T23:59:00Z')).toEqual({ ok: true }); // 4:59 PM Arizona
  });

  it('8 PM is refused, and the next morning offered', () => {
    // Wednesday 8 PM in Arizona: Thursday 11 AM.
    const az = check('2026-11-12T03:00:00Z', AZ);
    expect(offer(az)).toBe('outside_hours 2026-11-12T18:00:00.000Z');
    expect(spokenTime(offered(az), AZ, NOW)).toBe('tomorrow at 11 AM your time');
    // Wednesday 8 PM in New York (6 PM Arizona): the same opening, 1 PM there.
    const ny = check('2026-11-12T01:00:00Z');
    expect(offer(ny)).toBe('outside_hours 2026-11-12T18:00:00.000Z');
    expect(spokenTime(offered(ny), NY, NOW)).toBe('tomorrow at 1 PM your time');
  });

  it('5 PM in Arizona is closed: the hours end before it', () => {
    expect(offer(check('2026-11-13T00:00:00Z', AZ))).toBe('outside_hours 2026-11-13T18:00:00.000Z');
  });

  it('before the opening: that day\'s opening', () => {
    // Thursday 9 AM in New York, 7 AM in Arizona: Thursday 1 PM New York.
    expect(offer(check('2026-11-12T14:00:00Z'))).toBe('outside_hours 2026-11-12T18:00:00.000Z');
  });

  it('a weekend is refused, and Monday offered - at the same time on the lead\'s clock', () => {
    const saturday = check('2026-11-14T20:00:00Z'); // Saturday 3 PM New York
    expect(offer(saturday)).toBe('outside_hours 2026-11-16T20:00:00.000Z');
    expect(spokenTime(offered(saturday), NY, NOW)).toBe('Monday at 3 PM your time');
    expect(offer(check('2026-11-15T20:00:00Z'))).toBe('outside_hours 2026-11-16T20:00:00.000Z'); // Sunday
  });

  it('a weekend evening: Monday\'s opening', () => {
    expect(offer(check('2026-11-15T01:00:00Z'))).toBe('outside_hours 2026-11-16T18:00:00.000Z'); // Saturday 8 PM New York
    expect(offer(check('2026-11-14T01:00:00Z', AZ))).toBe('outside_hours 2026-11-16T18:00:00.000Z'); // Friday 6 PM Arizona
  });

  it('the same time on the lead\'s clock across the clocks going back: 3 PM stays 3 PM', () => {
    const summerNow = at('2026-10-28T19:00:00Z'); // Wednesday noon, Arizona
    // Saturday 31 October 3 PM New York (EDT, noon in Arizona) -> Monday 2 November 3 PM (EST, 1 PM in Arizona).
    expect(offer(check('2026-10-31T19:00:00Z', NY, summerNow))).toBe('outside_hours 2026-11-02T20:00:00.000Z');
  });

  it('in summer, 3 PM in New York is noon in Arizona - inside the hours', () => {
    const summerNow = at('2026-07-15T19:00:00Z'); // Wednesday noon, Arizona
    const thursday = atLocalTime('2026-07-16T15:00', NY)!;
    expect(checkCallbackTime(thursday, NY, DEFAULT_CALL_HOURS, summerNow)).toEqual({ ok: true });
    expect(spokenTime(thursday, NY, summerNow)).toBe('tomorrow at 3 PM your time');
    expect(spokenTime(thursday, AZ, summerNow)).toBe('tomorrow at 12 PM your time');
  });

  it('in the past: the first quarter hour far enough ahead', () => {
    expect(offer(check('2026-11-11T18:00:00Z'))).toBe('past 2026-11-11T19:15:00.000Z'); // 11 AM today, an hour ago
    expect(offer(check('2026-11-10T20:00:00Z'))).toBe('past 2026-11-11T19:15:00.000Z'); // yesterday
  });

  it('too soon - less than 15 minutes away', () => {
    expect(offer(check('2026-11-11T19:05:00Z'))).toBe('too_soon 2026-11-11T19:15:00.000Z');
    expect(check('2026-11-11T19:15:00Z')).toEqual({ ok: true });
    // At 12:07 the first quarter hour 15 minutes away is 12:30.
    expect(offer(check('2026-11-11T19:10:00Z', NY, at('2026-11-11T19:07:00Z')))).toBe('too_soon 2026-11-11T19:30:00.000Z');
  });

  it('too soon at the end of the day: the next opening', () => {
    const late = at('2026-11-11T23:50:00Z'); // 4:50 PM Arizona
    expect(offer(check('2026-11-11T23:55:00Z', NY, late))).toBe('too_soon 2026-11-12T18:00:00.000Z');
  });

  it('within two weeks; beyond, the same time on the last day in reach', () => {
    expect(check('2026-11-25T18:00:00Z')).toEqual({ ok: true }); // Wednesday 25th, 11 AM Arizona - 13 days 23 hours
    // Tuesday 1 December 3 PM New York -> Tuesday 24 November 3 PM: the 25th's 3 PM is past the limit.
    const far = check('2026-12-01T20:00:00Z');
    expect(offer(far)).toBe('too_far 2026-11-24T20:00:00.000Z');
    expect(spokenTime(offered(far), NY, NOW)).toBe('Tuesday, November 24 at 3 PM your time');
    expect(MAX_AHEAD_DAYS).toBe(14);
  });

  it('the hours and days the settings name', () => {
    const saturdays = { ...DEFAULT_CALL_HOURS, days: new Set(DEFAULT_CALL_HOURS.days).add('sat') };
    expect(check('2026-11-14T20:00:00Z', NY, NOW, saturdays)).toEqual({ ok: true });
    const mornings = { ...DEFAULT_CALL_HOURS, startMinute: 8 * 60, endMinute: 12 * 60 };
    expect(offer(check('2026-11-12T20:00:00Z', NY, NOW, mornings))).toBe('outside_hours 2026-11-13T15:00:00.000Z'); // Friday 8 AM Arizona
  });

  it('no offer only when the settings allow no time at all', () => {
    expect(offer(check('2026-11-12T20:00:00Z', NY, NOW, { ...DEFAULT_CALL_HOURS, days: new Set() }))).toBe(
      'outside_hours undefined'
    );
  });
});

describe('how Seri says a time', () => {
  const say = (iso: string, zone = NY) => spokenTime(at(iso), zone, NOW);

  it('today, tomorrow, the day within the week, the date beyond it', () => {
    expect(say('2026-11-11T21:00:00Z')).toBe('today at 4 PM your time');
    expect(say('2026-11-12T20:00:00Z')).toBe('tomorrow at 3 PM your time');
    expect(say('2026-11-17T20:00:00Z')).toBe('Tuesday at 3 PM your time'); // six days
    expect(say('2026-11-18T20:00:00Z')).toBe('Wednesday, November 18 at 3 PM your time'); // a week - not "Wednesday"
  });

  it('on the lead\'s own clock', () => {
    expect(say('2026-11-12T20:00:00Z', AZ)).toBe('tomorrow at 1 PM your time');
    expect(say('2026-11-12T20:00:00Z', 'America/Los_Angeles')).toBe('tomorrow at 12 PM your time');
    // 11 PM Wednesday in Arizona is already Thursday in New York.
    expect(say('2026-11-12T06:00:00Z', AZ)).toBe('today at 11 PM your time');
    expect(say('2026-11-12T06:00:00Z')).toBe('tomorrow at 1 AM your time');
  });

  it('minutes when there are some; noon and midnight as 12', () => {
    expect(say('2026-11-12T16:30:00Z')).toBe('tomorrow at 11:30 AM your time');
    expect(say('2026-11-12T17:05:00Z')).toBe('tomorrow at 12:05 PM your time');
    expect(say('2026-11-12T05:00:00Z')).toBe('tomorrow at 12 AM your time');
  });
});
