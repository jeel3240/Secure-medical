import { describe, expect, it } from 'vitest';
import { answersTitle, orderText } from './QueuePage';

const answers = [
  { key: 'q1', heading: 'Requested info', label: 'Yes' },
  { key: 'q2', heading: 'Used telemedicine', label: 'No' },
  { key: 'q3', heading: 'Next step', label: 'Talk to an agent' },
];

describe('a lead\'s answers in the queue', () => {
  it('name their questions on hover', () => {
    expect(answersTitle(answers)).toBe('Requested info: Yes\nUsed telemedicine: No\nNext step: Talk to an agent');
  });

  it('name nothing when nothing has been answered', () => {
    expect(answersTitle([])).toBeUndefined();
  });
});

describe('the order, as the page states it', () => {
  it('a "yes" nobody took and Seri\'s due call backs first, then the tiers, newest first - T22, A16, B01', () => {
    expect(orderText(true)).toBe("Missed transfers and Seri's due call backs first, then Hot, Warm and Low, newest first.");
  });

  it('with automated calls off, only the tiers: there are no transfers to miss', () => {
    expect(orderText(false)).toBe('Hot, Warm and Low, newest first.');
  });
});
