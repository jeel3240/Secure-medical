import { describe, expect, it } from 'vitest';
import { breakdownLabel, breakdownShade } from './LeadAnswers';

describe('score breakdown shades', () => {
  it('run from light blue to the brand navy', () => {
    expect(breakdownShade(0, 5)).toContain('var(--color-primary) 20%');
    expect(breakdownShade(4, 5)).toContain('var(--color-primary) 100%');
  });

  it('give a single line the navy', () => {
    expect(breakdownShade(0, 1)).toContain('var(--color-primary) 100%');
  });
});

describe('a line of the score breakdown', () => {
  it('names an answer by what was asked, in the words the server sent', () => {
    expect(breakdownLabel({ code: 'q1_1', label: 'Yes', heading: 'Requested info' })).toBe('Requested info: Yes');
    expect(breakdownLabel({ code: 'q1-a_2', label: 'Learn more', heading: 'Offers' })).toBe('Offers: Learn more');
  });

  it('has its own words for the two awards', () => {
    expect(breakdownLabel({ code: 'responded', label: 'Responded' })).toBe('Responded to SMS');
    expect(breakdownLabel({ code: 'completed', label: 'Completed' })).toBe('Completed flow');
  });

  it('shows the bare answer when no heading came with it', () => {
    expect(breakdownLabel({ code: 'q3_1', label: 'Call me now' })).toBe('Call me now');
  });
});
