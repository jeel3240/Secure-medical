/** An outcome's words, as every screen shows them - B04. */
import { describe, expect, it } from 'vitest';
import { CLOSE_REASONS, outcomeLabel } from './workspace';

describe('an outcome as the screens name it', () => {
  it('Closed with why: "Closed · Sold"', () => {
    expect(outcomeLabel('closed', 'sold')).toBe('Closed · Sold');
    expect(outcomeLabel('closed', 'not_interested')).toBe('Closed · Not interested');
    expect(outcomeLabel('closed', 'wrong_number')).toBe('Closed · Wrong number');
  });

  it('Closed alone, for one saved before the reason was asked', () => {
    expect(outcomeLabel('closed', null)).toBe('Closed');
    expect(outcomeLabel('closed')).toBe('Closed');
  });

  it('every other outcome in its own words, retired ones too', () => {
    expect(outcomeLabel('dnc')).toBe('DNC');
    expect(outcomeLabel('callback_set')).toBe('Callback set');
  });

  it('a word it does not know, as it is', () => {
    expect(outcomeLabel('later', 'moved_away')).toBe('later · moved_away');
  });

  it('the three reasons, in the popup\'s order', () => {
    expect([...CLOSE_REASONS]).toEqual(['sold', 'not_interested', 'wrong_number']);
  });
});
