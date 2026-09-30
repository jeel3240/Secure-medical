import { describe, expect, it } from 'vitest';
import type { LeadDetail } from '../../api/workspace';
import { questionsLabel, sourceLabel } from './LeadHeader';

const convo = (over: Partial<NonNullable<LeadDetail['conversation']>>): LeadDetail['conversation'] => ({
  id: 1,
  status: 'open',
  step: 1,
  score: 0,
  tier: null,
  expiresAt: null,
  agentTookOverAt: null,
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
    ['on a question', convo({ step: 2 }), 'On Q2'],
    ['finished', convo({ status: 'completed', step: 3 }), 'Completed'],
    ['went quiet', convo({ status: 'expired', step: 2 }), 'Stopped at Q2'],
    ['unclear replies', convo({ status: 'review', step: 1 }), 'Needs review at Q1'],
    ['an agent took over', convo({ step: 1, agentTookOverAt: '2026-09-29T02:39:50Z' }), 'Agent took over at Q1'],
    ['blocked on arrival', convo({ status: 'suppressed' }), 'Not sent - blocked'],
    ['no conversation', null, 'Not started'],
  ])('questions: %s', (_, conversation, label) => {
    expect(questionsLabel(conversation)).toBe(label);
  });
});
