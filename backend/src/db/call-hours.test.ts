/**
 * Reading when the robot calls from `settings` - T20, `readCallHours`. A
 * stand-in for the database: what is under test is what each malformed value
 * becomes - migration 015's, never a guess.
 */
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { readCallHours } from './call-script';

const settings = (rows: Record<string, string>) => ({
  query: async () => ({ rows: Object.entries(rows).map(([key, value]) => ({ key, value })), rowCount: 0 }),
});

const SET = {
  auto_call_hours_start: '09:30',
  auto_call_hours_end: '16:00',
  auto_call_time_zone: 'America/New_York',
  auto_call_days: 'mon,wed',
  auto_call_wait_minutes: '45',
};

describe('when the robot calls, read from settings', () => {
  it('as the settings say', async () => {
    expect(await readCallHours(settings(SET))).toEqual({
      startMinute: 570,
      endMinute: 960,
      timeZone: 'America/New_York',
      days: new Set(['mon', 'wed']),
      waitMinutes: 45,
    });
  });

  it('nothing set: migration 015\'s values', async () => {
    expect(await readCallHours(settings({}))).toEqual(DEFAULT_CALL_HOURS);
  });

  it('the hours fall back together - one bad end of the window, or an end before the start, and both are 015\'s', async () => {
    for (const hours of [
      { auto_call_hours_start: '9am' },
      { auto_call_hours_end: '25:00' },
      { auto_call_hours_start: '17:00', auto_call_hours_end: '11:00' },
    ]) {
      const read = await readCallHours(settings({ ...SET, ...hours }));
      expect([read.startMinute, read.endMinute]).toEqual([DEFAULT_CALL_HOURS.startMinute, DEFAULT_CALL_HOURS.endMinute]);
      // The others are kept.
      expect(read.timeZone).toBe('America/New_York');
    }
  });

  it('a zone the server does not know, days it cannot read, a wait out of range: each 015\'s', async () => {
    const read = await readCallHours(
      settings({ ...SET, auto_call_time_zone: 'Mars/Olympus', auto_call_days: 'mon,someday', auto_call_wait_minutes: '0' })
    );
    expect([read.timeZone, read.days, read.waitMinutes]).toEqual([
      DEFAULT_CALL_HOURS.timeZone,
      DEFAULT_CALL_HOURS.days,
      DEFAULT_CALL_HOURS.waitMinutes,
    ]);
    expect((await readCallHours(settings({ ...SET, auto_call_wait_minutes: '20000' }))).waitMinutes).toBe(60);
    expect((await readCallHours(settings({ ...SET, auto_call_wait_minutes: '1.5' }))).waitMinutes).toBe(60);
  });
});
