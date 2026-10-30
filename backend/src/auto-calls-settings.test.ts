import { mayRing, readAutoCalls, readAutoCallTestNumbers } from './auto-calls-settings';

describe('AUTO_CALLS', () => {
  it('is on only when it says exactly "on"', () => {
    expect(readAutoCalls({ AUTO_CALLS: 'on' })).toEqual({ on: true, unknown: null });
  });

  it('is off, quietly, when unset, empty or "off"', () => {
    expect(readAutoCalls({})).toEqual({ on: false, unknown: null });
    expect(readAutoCalls({ AUTO_CALLS: '' })).toEqual({ on: false, unknown: null });
    expect(readAutoCalls({ AUTO_CALLS: 'off' })).toEqual({ on: false, unknown: null });
  });

  it.each(['true', 'yes', '1', 'ON', 'on ', ' on'])('is off, and named, when it says %j', (value) => {
    expect(readAutoCalls({ AUTO_CALLS: value })).toEqual({ on: false, unknown: value });
  });
});

describe('AUTO_CALL_TEST_NUMBERS - outside production, only our own phones are rung', () => {
  it('reads the numbers, comma-separated, as E.164', () => {
    const numbers = readAutoCallTestNumbers({ AUTO_CALL_TEST_NUMBERS: '+16025550123, +16025550124' }, false);
    expect([...numbers.only!]).toEqual(['+16025550123', '+16025550124']);
    expect(numbers.invalid).toBe(0);
    expect(mayRing(numbers, '+16025550124')).toBe(true);
    expect(mayRing(numbers, '+16025550199')).toBe(false);
  });

  it('empty or unset: nothing can be rung', () => {
    for (const env of [{}, { AUTO_CALL_TEST_NUMBERS: '' }, { AUTO_CALL_TEST_NUMBERS: ' , ' }]) {
      const numbers = readAutoCallTestNumbers(env, false);
      expect(numbers.only!.size).toBe(0);
      expect(mayRing(numbers, '+16025550123')).toBe(false);
    }
  });

  it('an entry that is not E.164 is ignored and counted - never a way to ring anyone', () => {
    const numbers = readAutoCallTestNumbers({ AUTO_CALL_TEST_NUMBERS: '6025550123,+16025550123,*,+1' }, false);
    expect([...numbers.only!]).toEqual(['+16025550123']);
    expect(numbers.invalid).toBe(3);
    expect(mayRing(numbers, '+6025550123')).toBe(false);
  });

  it('production does not read it: any lead may be rung', () => {
    const numbers = readAutoCallTestNumbers({ AUTO_CALL_TEST_NUMBERS: '+16025550123' }, true);
    expect(numbers.only).toBeNull();
    expect(mayRing(numbers, '+16025550199')).toBe(true);
  });
});
