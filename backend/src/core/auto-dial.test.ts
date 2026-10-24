/**
 * When the robot calls, and how many at once - T20, AUTO-CALLS.md "When a lead
 * is called" and "Traffic".
 */
import { callsToPlace, DEFAULT_CALL_HOURS, insideCallHours, parseClock, parseDays } from './auto-dial';

// Arizona is UTC-7 all year - no daylight saving - so 18:00Z is 11:00 there.
// 2026-10-26 is a Monday; 2026-10-24 a Saturday.
const at = (iso: string) => new Date(iso);

describe('the calling hours - 11am to 5pm, Arizona time, Monday to Friday', () => {
  it('from 11:00 on the dot, to just before 17:00', () => {
    expect(insideCallHours(at('2026-10-26T17:59:59Z'), DEFAULT_CALL_HOURS)).toBe(false); // 10:59:59
    expect(insideCallHours(at('2026-10-26T18:00:00Z'), DEFAULT_CALL_HOURS)).toBe(true); // 11:00
    expect(insideCallHours(at('2026-10-26T23:59:00Z'), DEFAULT_CALL_HOURS)).toBe(true); // 16:59
    expect(insideCallHours(at('2026-10-27T00:00:00Z'), DEFAULT_CALL_HOURS)).toBe(false); // 17:00
  });

  it('Monday to Friday only - Arizona\'s day, not UTC\'s', () => {
    expect(insideCallHours(at('2026-10-24T19:00:00Z'), DEFAULT_CALL_HOURS)).toBe(false); // Saturday noon
    expect(insideCallHours(at('2026-10-25T19:00:00Z'), DEFAULT_CALL_HOURS)).toBe(false); // Sunday noon
    expect(insideCallHours(at('2026-10-30T23:30:00Z'), DEFAULT_CALL_HOURS)).toBe(true); // Friday 16:30
    // Saturday in UTC already, still Friday 16:30 in Arizona.
    expect(insideCallHours(at('2026-10-31T00:30:00Z'), { ...DEFAULT_CALL_HOURS, endMinute: 18 * 60 })).toBe(true);
  });

  it('in whatever zone the settings name', () => {
    const newYork = { ...DEFAULT_CALL_HOURS, timeZone: 'America/New_York' };
    expect(insideCallHours(at('2026-10-26T15:00:00Z'), newYork)).toBe(true); // 11:00 EDT
    expect(insideCallHours(at('2026-10-26T15:00:00Z'), DEFAULT_CALL_HOURS)).toBe(false); // 08:00 in Arizona
  });

  it('reads the settings\' words, or says it cannot', () => {
    expect(parseClock('11:00')).toBe(660);
    expect(parseClock(' 17:30 ')).toBe(1050);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('11am')).toBeNull();
    expect(parseClock(undefined)).toBeNull();
    expect(parseDays('mon,tue, WED')).toEqual(new Set(['mon', 'tue', 'wed']));
    expect(parseDays('mon,funday')).toBeNull();
    expect(parseDays('')).toBeNull();
  });
});

describe('how many calls at once - Traffic', () => {
  const room = { free: 3, underway: 0, onHold: false, silent: 0, scripted: true };

  it('as many as there are people free, less the robot\'s calls still going with nobody on them', () => {
    expect(callsToPlace(room)).toBe(3);
    expect(callsToPlace({ ...room, underway: 2 })).toBe(1);
    expect(callsToPlace({ ...room, free: 2, underway: 3 })).toBe(0);
  });

  it('nobody free: none', () => {
    expect(callsToPlace({ ...room, free: 0 })).toBe(0);
  });

  it('a lead waiting on hold: none, however many are free', () => {
    expect(callsToPlace({ ...room, free: 5, onHold: true })).toBe(0);
  });

  it('Twilio\'s reports not reaching us: none - each call would reach a lead as an error, and use up their one call', () => {
    expect(callsToPlace({ ...room, silent: 1 })).toBe(0);
  });

  it('no call script: none - nothing to say', () => {
    expect(callsToPlace({ ...room, scripted: false })).toBe(0);
  });
});
