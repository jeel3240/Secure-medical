import { describe, expect, it } from 'vitest';
import { answersText, answersTitle } from './QueuePage';

const answers = [
  { key: 'q1', heading: 'Requested info', label: 'Yes' },
  { key: 'q2', heading: 'Used telemedicine', label: 'No' },
  { key: 'q3', heading: 'Next step', label: 'Talk to an agent' },
];

describe('a lead\'s answers in the queue', () => {
  it('are one cell, in order, however many the flow asked', () => {
    expect(answersText(answers)).toBe('Yes · No · Talk to an agent');
    expect(answersText(answers.slice(0, 1))).toBe('Yes');
  });

  it('name their questions on hover', () => {
    expect(answersTitle(answers)).toBe('Requested info: Yes\nUsed telemedicine: No\nNext step: Talk to an agent');
  });

  it('are a hyphen when nothing has been answered', () => {
    expect(answersText([])).toBe('-');
    expect(answersTitle([])).toBeUndefined();
  });
});
