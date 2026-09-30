import { describe, expect, it } from 'vitest';
import { breakdownShade } from './LeadAnswers';

describe('score breakdown shades', () => {
  it('run from light blue to the brand navy', () => {
    expect(breakdownShade(0, 5)).toContain('var(--color-primary) 20%');
    expect(breakdownShade(4, 5)).toContain('var(--color-primary) 100%');
  });

  it('give a single line the navy', () => {
    expect(breakdownShade(0, 1)).toContain('var(--color-primary) 100%');
  });
});
