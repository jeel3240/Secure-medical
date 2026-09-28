import { CLOSING_DISPOSITIONS, DISPOSITIONS, DNC_DISPOSITION, isDisposition } from './dispositions';

describe('dispositions', () => {
  it('can record a sale', () => {
    expect(isDisposition('sold')).toBe(true);
  });

  it('close a lead on Sold, Not interested and Wrong number only', () => {
    // The rest mean "try again", so the lead must stay in the queue.
    expect([...CLOSING_DISPOSITIONS].sort()).toEqual(['not_interested', 'sold', 'wrong_number']);
  });

  it('close only with values that exist', () => {
    CLOSING_DISPOSITIONS.forEach((value) => expect(DISPOSITIONS).toContain(value));
  });

  it('leave DNC out of the closing list - blocking the number already removes the lead', () => {
    expect(CLOSING_DISPOSITIONS).not.toContain(DNC_DISPOSITION);
  });
});
