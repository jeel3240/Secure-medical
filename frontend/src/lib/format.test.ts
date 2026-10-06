/**
 * Formatting that the queue and the workspace depend on.
 *
 * Tested because the age thresholds are a judgement the design brief made - a
 * HOT lead going red at 15 minutes - and a wrong boundary looks like a working
 * screen. The rest is cheap to cover once the file has a test.
 */
import { describe, expect, it } from 'vitest';
import { formatAge, formatPhone, formatRelative, leadName, shortName, toLocalInput } from './format';

const NOW = new Date('2026-09-26T12:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

describe('formatAge', () => {
  it('counts in m:ss', () => {
    expect(formatAge(ago(0), NOW)).toBe('0:00');
    expect(formatAge(ago(9), NOW)).toBe('0:09');
    expect(formatAge(ago(75), NOW)).toBe('1:15');
    expect(formatAge(ago(59 * 60 + 59), NOW)).toBe('59:59');
  });

  it('switches to hours past an hour', () => {
    // 72:30 is harder to read at a glance than 1h 12m.
    expect(formatAge(ago(3600), NOW)).toBe('1h 0m');
    expect(formatAge(ago(3600 + 12 * 60), NOW)).toBe('1h 12m');
  });

  it('switches to days past a day', () => {
    expect(formatAge(ago(25 * 3600), NOW)).toBe('1d 1h');
  });

  it('never counts backwards', () => {
    // Clock skew between the server and the browser must not print "-1:-30".
    const future = new Date(NOW.getTime() + 30_000).toISOString();
    expect(formatAge(future, NOW)).toBe('0:00');
  });

  it('handles a lead with no received time', () => {
    expect(formatAge(null, NOW)).toBe('-');
  });
});

describe('leadName', () => {
  it('is first name plus last initial', () => {
    expect(leadName({ firstName: 'Jordan', lastName: 'Miller' })).toBe('Jordan M.');
  });

  it('copes with a missing surname', () => {
    expect(leadName({ firstName: 'Jordan', lastName: null })).toBe('Jordan');
  });

  it('falls back when there is no name at all', () => {
    expect(leadName({ firstName: null, lastName: null })).toBe('Unknown');
    expect(leadName({ firstName: '  ', lastName: null })).toBe('Unknown');
  });
});

describe('formatPhone', () => {
  it('groups a US number', () => {
    expect(formatPhone('+16025550142')).toBe('(602) 555-0142');
  });

  it('leaves anything else as stored', () => {
    expect(formatPhone('+442071838750')).toBe('+442071838750');
  });
});

describe('formatRelative', () => {
  it('reads in the largest sensible unit', () => {
    expect(formatRelative(ago(30), NOW)).toBe('just now');
    expect(formatRelative(ago(120), NOW)).toBe('2m ago');
    expect(formatRelative(ago(7200), NOW)).toBe('2h ago');
    expect(formatRelative(ago(3 * 86400), NOW)).toBe('3d ago');
  });
});

describe('toLocalInput', () => {
  // The one copy since 2026-09-28; Wrap up passes a Date, My Callbacks an ISO string.
  it('gives local time with no zone, from a Date or an ISO string alike', () => {
    const d = new Date(2026, 8, 28, 9, 5);
    expect(toLocalInput(d)).toBe('2026-09-28T09:05');
    expect(toLocalInput(d.toISOString())).toBe('2026-09-28T09:05');
  });
});

describe('a full name, shortened the way every screen shows a lead', () => {
  it.each([
    ['Leo Martinez', 'Leo M.'],
    ['Leo', 'Leo'],
    ['Mary Anne Smith', 'Mary S.'],
    ['  ', ''],
    ['', ''],
  ])('%j -> %j', (full, short) => {
    expect(shortName(full)).toBe(short);
  });
});
