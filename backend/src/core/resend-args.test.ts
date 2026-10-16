import { arizonaTime, parseResendArgs, parseWhen, type ResendOptions } from './resend-args';

const NOW = new Date('2026-10-16T17:00:00Z');

function options(argv: string[]): ResendOptions {
  const parsed = parseResendArgs(argv, NOW);
  if (!parsed.ok) throw new Error(`expected options, got ${JSON.stringify(parsed)}`);
  return parsed.options;
}

function error(argv: string[]): string {
  const parsed = parseResendArgs(argv, NOW);
  if (parsed.ok || !('error' in parsed)) throw new Error(`expected an error, got ${JSON.stringify(parsed)}`);
  return parsed.error;
}

describe('parseWhen', () => {
  it('reads a date as midnight Arizona time, which is 07:00 UTC all year', () => {
    expect(parseWhen('2026-10-14')?.toISOString()).toBe('2026-10-14T07:00:00.000Z');
    // January too: Arizona keeps no daylight saving.
    expect(parseWhen('2026-01-14')?.toISOString()).toBe('2026-01-14T07:00:00.000Z');
  });

  it('reads a date and time without an offset as Arizona time', () => {
    expect(parseWhen('2026-10-14T09:30')?.toISOString()).toBe('2026-10-14T16:30:00.000Z');
    expect(parseWhen('2026-10-14T09:30:15')?.toISOString()).toBe('2026-10-14T16:30:15.000Z');
  });

  it('takes a time with Z or an offset as written', () => {
    expect(parseWhen('2026-10-14T16:30Z')?.toISOString()).toBe('2026-10-14T16:30:00.000Z');
    expect(parseWhen('2026-10-14T12:30-04:00')?.toISOString()).toBe('2026-10-14T16:30:00.000Z');
    expect(parseWhen('2026-10-14T22:00+05:30')?.toISOString()).toBe('2026-10-14T16:30:00.000Z');
  });

  it('refuses a day that does not exist, rather than moving it', () => {
    // JavaScript's own parser makes this 2 March.
    expect(parseWhen('2026-02-30')).toBeNull();
    expect(parseWhen('2026-02-29')).toBeNull();
    expect(parseWhen('2028-02-29')?.toISOString()).toBe('2028-02-29T07:00:00.000Z');
    expect(parseWhen('2026-13-01')).toBeNull();
    expect(parseWhen('2026-10-00')).toBeNull();
  });

  it('refuses a time that does not exist', () => {
    expect(parseWhen('2026-10-14T24:00')).toBeNull();
    expect(parseWhen('2026-10-14T09:60')).toBeNull();
    expect(parseWhen('2026-10-14T09:30+15:00')).toBeNull();
  });

  it('refuses anything that is not a date', () => {
    for (const text of ['', 'yesterday', '14/10/2026', '2026-10-14 09:30', '2026-10-14T9:30', '20261014']) {
      expect(parseWhen(text)).toBeNull();
    }
  });
});

describe('parseResendArgs', () => {
  it('needs only --from: --to is now, one text every 30 seconds, no limit, sending', () => {
    expect(options(['--from', '2026-10-14'])).toEqual({
      from: new Date('2026-10-14T07:00:00Z'),
      to: NOW,
      everyMs: 30_000,
      limit: null,
      dryRun: false,
    });
  });

  it('reads every option, in any order', () => {
    expect(
      options(['--dry-run', '--limit', '5', '--to', '2026-10-16T08:00', '--every', '2m', '--from', '2026-10-14'])
    ).toEqual({
      from: new Date('2026-10-14T07:00:00Z'),
      to: new Date('2026-10-16T15:00:00Z'),
      everyMs: 120_000,
      limit: 5,
      dryRun: true,
    });
  });

  it('reads --every in seconds, with or without "s"', () => {
    expect(options(['--from', '2026-10-14', '--every', '45']).everyMs).toBe(45_000);
    expect(options(['--from', '2026-10-14', '--every', '45s']).everyMs).toBe(45_000);
  });

  it('never sends faster than one text every 10 seconds', () => {
    expect(options(['--from', '2026-10-14', '--every', '10']).everyMs).toBe(10_000);
    expect(error(['--from', '2026-10-14', '--every', '9'])).toMatch(/at least 10 seconds/);
    expect(error(['--from', '2026-10-14', '--every', '0'])).toMatch(/at least 10 seconds/);
  });

  it('refuses a pace that is not a number of seconds or minutes', () => {
    expect(error(['--from', '2026-10-14', '--every', 'fast'])).toMatch(/not a number of seconds/);
    expect(error(['--from', '2026-10-14', '--every', '1h'])).toMatch(/not a number of seconds/);
    expect(error(['--from', '2026-10-14', '--every', '-30'])).toMatch(/needs a value|not a number/);
  });

  it('needs a whole number of at least 1 for --limit', () => {
    expect(options(['--from', '2026-10-14', '--limit', '1']).limit).toBe(1);
    for (const value of ['0', '2.5', 'five', '-1']) {
      expect(error(['--from', '2026-10-14', '--limit', value])).toMatch(/--limit|needs a value/);
    }
  });

  it('refuses to run without --from', () => {
    expect(error([])).toMatch(/--from is required/);
    expect(error(['--dry-run'])).toMatch(/--from is required/);
  });

  it('refuses a window that ends before it starts', () => {
    expect(error(['--from', '2026-10-15', '--to', '2026-10-14'])).toMatch(/before --to/);
    expect(error(['--from', '2026-10-14', '--to', '2026-10-14'])).toMatch(/before --to/);
    // --to defaults to now, so a --from in the future is refused too.
    expect(error(['--from', '2026-10-20'])).toMatch(/before --to/);
  });

  it('refuses a bad date, naming the flag', () => {
    expect(error(['--from', '2026-02-30'])).toMatch(/--from 2026-02-30 is not a date/);
    expect(error(['--from', '2026-10-14', '--to', 'tomorrow'])).toMatch(/--to tomorrow is not a date/);
  });

  it('refuses a flag with no value, rather than taking the next flag as one', () => {
    expect(error(['--from'])).toMatch(/--from needs a value/);
    expect(error(['--from', '--dry-run'])).toMatch(/--from needs a value/);
  });

  it('refuses an unknown argument, so a typo never sends', () => {
    expect(error(['--from', '2026-10-14', '--dryrun'])).toMatch(/Unknown argument: --dryrun/);
    expect(error(['--from', '2026-10-14', '5'])).toMatch(/Unknown argument: 5/);
  });

  it('answers --help with the usage instead of running', () => {
    expect(parseResendArgs(['--help'], NOW)).toEqual({ ok: false, help: true });
    expect(parseResendArgs(['--from', '2026-10-14', '-h'], NOW)).toEqual({ ok: false, help: true });
  });
});

describe('arizonaTime', () => {
  it('prints a moment in Arizona time', () => {
    expect(arizonaTime(new Date('2026-10-14T16:12:00Z'))).toBe('Oct 14, 2026, 9:12 AM');
    expect(arizonaTime(new Date('2026-10-14T07:00:00Z'))).toBe('Oct 14, 2026, 12:00 AM');
  });
});
