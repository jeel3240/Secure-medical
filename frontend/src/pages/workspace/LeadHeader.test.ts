import { describe, expect, it } from 'vitest';
import type { LeadDetail } from '../../api/workspace';
import { questionsLabel, sourceLabel } from './LeadHeader';

const convo = (over: Partial<NonNullable<LeadDetail['conversation']>>): LeadDetail['conversation'] => ({
  id: 1,
  status: 'open',
  step: 1,
  question: null,
  score: 0,
  tier: null,
  expiresAt: null,
  agentTookOverAt: null,
  flow: 'antibiotics',
  endOutcome: null,
  ...over,
});

describe('the header in words', () => {
  it('names the source plainly', () => {
    expect(sourceLabel('WEBINTERFACE')).toBe('Web interface');
    expect(sourceLabel('API')).toBe('API');
    expect(sourceLabel('CORE-G-27')).toBe('CORE-G-27');
    expect(sourceLabel(null)).toBeNull();
  });

  it.each<[string, LeadDetail['conversation'], string]>([
    ['on a question', convo({ step: 20, question: 'Q2' }), 'On Q2'],
    // The offers question: a sub-question of the first.
    ['said No, on the sub-question', convo({ step: 11, question: 'Q1-a' }), 'On Q1-a'],
    ['went quiet on it', convo({ status: 'expired', step: 11, question: 'Q1-a' }), 'Stopped at Q1-a'],
    // The position is an order, not a question number: no name, no made-up one.
    ['a row whose question cannot be found', convo({ step: 20 }), 'Open'],
    ['the same, gone quiet', convo({ status: 'expired', step: 20 }), 'Stopped'],
    ['finished', convo({ status: 'completed', step: 3 }), 'Completed'],
    ['said No, asked for offers', convo({ status: 'completed', step: 4, endOutcome: 'offers' }), 'Offers only'],
    ['said No, asked for a rep', convo({ status: 'completed', step: 4, endOutcome: 'wants_contact' }), 'Wants a call'],
    ['said No, then no thanks', convo({ status: 'completed', step: 4, endOutcome: 'declined' }), 'Not interested'],
    ['went quiet', convo({ status: 'expired', step: 20, question: 'Q2' }), 'Stopped at Q2'],
    ['unclear replies', convo({ status: 'review', step: 10, question: 'Q1' }), 'Needs review at Q1'],
    ['an agent took over', convo({ step: 10, question: 'Q1', agentTookOverAt: '2026-09-29T02:39:50Z' }), 'Agent took over at Q1'],
    ['blocked on arrival', convo({ status: 'suppressed' }), 'Not sent - blocked'],
    ['no conversation', null, 'Not started'],
  ])('questions: %s', (_, conversation, label) => {
    expect(questionsLabel(conversation)).toBe(label);
  });
});
