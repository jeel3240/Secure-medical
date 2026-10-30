import { describe, expect, it } from 'vitest';
import type { LeadDetail } from '../../api/workspace';
import { sendingStopsQuestions } from './SmsCompose';

const convo = (over: Partial<NonNullable<LeadDetail['conversation']>>): LeadDetail['conversation'] => ({
  id: 1,
  status: 'open',
  step: 10,
  question: 'Q1',
  score: 0,
  tier: null,
  expiresAt: null,
  agentTookOverAt: null,
  phoneTookOverAt: null,
  flow: 'antibiotics',
  endOutcome: null,
  ...over,
});

describe('the warning that sending stops the automated questions', () => {
  it('shows while the questions are running and nobody has taken them over', () => {
    expect(sendingStopsQuestions(convo({}))).toBe(true);
  });

  it('does not show once an agent has texted, or a phone call stopped them (2d)', () => {
    expect(sendingStopsQuestions(convo({ agentTookOverAt: '2026-10-27T19:00:00.000Z' }))).toBe(false);
    expect(sendingStopsQuestions(convo({ phoneTookOverAt: '2026-10-27T19:00:00.000Z' }))).toBe(false);
  });

  it('does not show when the questions are over - there is nothing left to stop', () => {
    for (const status of ['completed', 'expired', 'review', 'suppressed']) {
      expect(sendingStopsQuestions(convo({ status }))).toBe(false);
    }
  });

  it('does not show for a lead with no conversation', () => {
    expect(sendingStopsQuestions(null)).toBe(false);
  });
});
