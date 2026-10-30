/** The automated call's settings in words - Admin > Configuration, T24. */
import { describe, expect, it } from 'vitest';
import { clockText, daysText, minutesText } from './call-settings';

describe('the calling hours', () => {
  it('reads minutes after midnight as a clock', () => {
    expect(clockText(660)).toBe('11:00 AM');
    expect(clockText(1020)).toBe('5:00 PM');
    expect(clockText(690)).toBe('11:30 AM');
    expect(clockText(0)).toBe('12:00 AM');
    expect(clockText(720)).toBe('12:00 PM');
    expect(clockText(1439)).toBe('11:59 PM');
  });
});

describe('the calling days', () => {
  it('says a run of days as a range, in the week\'s order', () => {
    expect(daysText(['mon', 'tue', 'wed', 'thu', 'fri'])).toBe('Monday to Friday');
    expect(daysText(['fri', 'thu', 'wed', 'tue', 'mon'])).toBe('Monday to Friday');
    expect(daysText(['sat', 'sun'])).toBe('Saturday to Sunday');
  });

  it('names each day otherwise', () => {
    expect(daysText(['mon', 'wed', 'fri'])).toBe('Monday, Wednesday, Friday');
    expect(daysText(['tue'])).toBe('Tuesday');
    expect(daysText([])).toBe('-');
  });
});

describe('a wait', () => {
  it('in hours when it is whole hours, minutes otherwise', () => {
    expect(minutesText(60)).toBe('1 hour');
    expect(minutesText(120)).toBe('2 hours');
    expect(minutesText(90)).toBe('90 minutes');
    expect(minutesText(10)).toBe('10 minutes');
    expect(minutesText(1)).toBe('1 minute');
  });
});
