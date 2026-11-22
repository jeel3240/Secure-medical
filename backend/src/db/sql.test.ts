import { DEFAULT_EXPIRY_DAYS, DEFAULT_POLL_INTERVAL_SECONDS, expiryDays, isTimeZone, likeLiteral, pollIntervalSeconds, readExpiryDays, startOfTodaySql } from './sql';

describe('likeLiteral', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(likeLiteral('50%_off\\now')).toBe('50\\%\\_off\\\\now');
  });

  it('leaves ordinary text alone', () => {
    expect(likeLiteral('Maria 555')).toBe('Maria 555');
  });

  it('never produces the text "${c}" - the DNC copy did, 2026-09-28', () => {
    expect(likeLiteral('%')).not.toContain('${c}');
  });
});

describe('readExpiryDays', () => {
  const settingOf = (value: unknown) => ({ query: async () => ({ rows: value === undefined ? [] : [{ value }] }) });

  it('reads the setting', async () => {
    expect(await readExpiryDays(settingOf('10'))).toBe(10);
  });

  it.each([undefined, '', 'abc', '0', '-3'])('falls back to 7 for %p', async (value) => {
    expect(await readExpiryDays(settingOf(value))).toBe(DEFAULT_EXPIRY_DAYS);
  });
});

describe('time zones', () => {
  it.each(['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'America/Argentina/Buenos_Aires'])('accepts %s', (tz) => {
    expect(isTimeZone(tz)).toBe(true);
  });

  it.each(['', 'Mars/Olympus', "UTC'; DROP TABLE leads; --", 42, undefined])('refuses %p', (tz) => {
    expect(isTimeZone(tz)).toBe(false);
  });

  it("builds midnight in the viewer's zone, not the database's", () => {
    expect(startOfTodaySql('America/Los_Angeles')).toBe(
      "(date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles')"
    );
  });

  it('refuses to build SQL from anything that is not a zone', () => {
    expect(() => startOfTodaySql("x' OR '1'='1")).toThrow();
  });
});

describe('the settings every reader takes alike (review M17)', () => {
  it.each([
    ['7', 7],
    ['3.5', 3.5],
    [undefined, DEFAULT_EXPIRY_DAYS],
    [null, DEFAULT_EXPIRY_DAYS],
    ['0', DEFAULT_EXPIRY_DAYS],
    ['-2', DEFAULT_EXPIRY_DAYS],
    ['week', DEFAULT_EXPIRY_DAYS],
  ] as const)('expiry_days %p: %p days', (raw, days) => {
    expect(expiryDays(raw)).toBe(days);
  });

  it.each([
    ['30', 30],
    ['45', 45],
    [undefined, DEFAULT_POLL_INTERVAL_SECONDS],
    ['0', DEFAULT_POLL_INTERVAL_SECONDS],
    ['-5', DEFAULT_POLL_INTERVAL_SECONDS],
    ['soon', DEFAULT_POLL_INTERVAL_SECONDS],
  ] as const)('poll_interval_seconds %p: %p seconds - the worker\'s and Admin > Leads\' alike', (raw, seconds) => {
    expect(pollIntervalSeconds(raw)).toBe(seconds);
  });
});
