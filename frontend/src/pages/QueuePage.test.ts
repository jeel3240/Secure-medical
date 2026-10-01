import { describe, expect, it } from 'vitest';
import { answer } from './QueuePage';

describe('an answer in the queue', () => {
  it('shows the word saved with it, not the choice\'s built-in name', () => {
    // Choice 1 of question 1 is "Supplements" in the built-in names; this lead
    // picked it when it was called something else.
    expect(answer(1, '1', 'Vitamins')).toBe('Vitamins');
  });

  it('falls back to the built-in name for a row with no saved word', () => {
    expect(answer(1, '1', null)).toBe('Supplements');
  });

  it('is a hyphen when the question has not been answered', () => {
    expect(answer(2, null, null)).toBe('-');
    expect(answer(2, null, 'Today')).toBe('-');
  });
});
