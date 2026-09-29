import { CLOSING_DISPOSITIONS, DISPOSITIONS, DNC_DISPOSITION, RETIRED_DISPOSITIONS, isDisposition } from './dispositions';

describe('dispositions', () => {
  it('are Closed and DNC only - Jeel, 2026-09-28', () => {
    expect([...DISPOSITIONS]).toEqual(['closed', 'dnc']);
  });

  it('no longer accept the retired ones', () => {
    RETIRED_DISPOSITIONS.forEach((value) => expect(isDisposition(value)).toBe(false));
  });

  it('close a lead on Closed, and on the retired values that meant the same', () => {
    // So a lead closed as Sold, Not interested or Wrong number stays closed.
    expect([...CLOSING_DISPOSITIONS].sort()).toEqual(['closed', 'not_interested', 'sold', 'wrong_number']);
  });

  it('leave DNC out of the closing list - blocking the number already removes the lead', () => {
    expect(CLOSING_DISPOSITIONS).not.toContain(DNC_DISPOSITION);
  });
});
