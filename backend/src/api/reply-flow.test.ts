import type { Conversation } from '../core/state-machine';
import { newAnswerLabels } from './reply-flow';

const LABELS = new Map([
  ['q1_1', 'Supplements'],
  ['q1_3', 'Both'],
  ['q2_2', 'This week'],
  ['q3_1', 'Call me now'],
]);

const at = (over: Partial<Conversation> = {}): Conversation => ({
  status: 'open',
  step: 1,
  q1: null,
  q2: null,
  q3: null,
  invalidCount: 0,
  score: 0,
  tier: null,
  agentTookOverAt: null,
  ...over,
});

describe('the word saved with an answer - migration 009', () => {
  it('is the choice\'s name at the moment the answer is given', () => {
    expect(newAnswerLabels(at(), at({ q1: '3', step: 2 }), LABELS)).toEqual(['Both', null, null]);
  });

  it('only for the question this reply answered, so earlier words are left alone', () => {
    const before = at({ q1: '3', step: 2 });
    expect(newAnswerLabels(before, at({ q1: '3', q2: '2', step: 3 }), LABELS)).toEqual([null, 'This week', null]);
  });

  it('nothing for a reply that answered nothing - unclear, or after the questions ended', () => {
    const same = at({ q1: '1', step: 2, invalidCount: 1 });
    expect(newAnswerLabels(at({ q1: '1', step: 2 }), same, LABELS)).toEqual([null, null, null]);
  });

  it('nothing when the choice has no name on record, rather than an empty word', () => {
    expect(newAnswerLabels(at(), at({ q1: '2', step: 2 }), LABELS)).toEqual([null, null, null]);
    expect(newAnswerLabels(at(), at({ q1: '2', step: 2 }), new Map([['q1_2', '']]))).toEqual([null, null, null]);
  });
});
