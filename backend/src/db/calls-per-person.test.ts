/**
 * Reading how many calls go at once for each person free - T29,
 * `readCallsPerPerson`. A stand-in for the database: what is under test is
 * what each value becomes - migration 021's 5 for anything it cannot use.
 */
import { DEFAULT_CALLS_PER_PERSON, readCallsPerPerson } from './call-script';

const settings = (value?: string) => ({
  query: async () => ({ rows: value === undefined ? [] : [{ value }], rowCount: 0 }),
});

describe('calls at once for each person free, read from settings', () => {
  it('as the setting says', async () => {
    expect(await readCallsPerPerson(settings('5'))).toBe(5);
    expect(await readCallsPerPerson(settings('1'))).toBe(1);
    expect(await readCallsPerPerson(settings('10'))).toBe(10);
  });

  it("missing, or not a whole number from 1 to 10: migration 021's 5", async () => {
    expect(DEFAULT_CALLS_PER_PERSON).toBe(5);
    for (const value of [undefined, '', '0', '11', '2.5', '-3', 'five']) {
      expect(await readCallsPerPerson(settings(value))).toBe(5);
    }
  });
});
