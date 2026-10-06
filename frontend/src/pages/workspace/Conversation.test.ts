import { describe, expect, it } from 'vitest';
import type { TimelineEntry } from '../../api/workspace';
import { replyLabel } from './Conversation';

const inbound = (body: string, answer?: string): TimelineEntry =>
  ({ kind: 'inbound', at: '2026-10-06T10:00:00Z', author: null, detail: answer ? { body, answer } : { body } }) as TimelineEntry;

describe('the answer shown beside a reply', () => {
  it('is the one the server recorded for that very text', () => {
    expect(replyLabel(inbound('1', 'Yes'))).toBe('Yes');
    expect(replyLabel(inbound('2', 'Learn more'))).toBe('Learn more');
    expect(replyLabel(inbound('y', 'Yes'))).toBe('Yes');
  });

  it('nothing for a reply that was not an answer', () => {
    // Unclear, or sent after the questions ended: the server attaches no answer,
    // and this screen no longer works one out.
    expect(replyLabel(inbound('who is this?'))).toBeNull();
    expect(replyLabel(inbound('1'))).toBeNull();
  });

  it('nothing when the lead typed the answer\'s own words - "Yes | Yes" says it twice', () => {
    expect(replyLabel(inbound('Yes', 'Yes'))).toBeNull();
    expect(replyLabel(inbound('yes!', 'Yes'))).toBeNull();
    expect(replyLabel(inbound('Learn more.', 'Learn more'))).toBeNull();
  });

  it('only for the lead\'s own texts', () => {
    const ours = { kind: 'sms', at: '2026-10-06T10:00:00Z', author: null, detail: { body: 'Q1', answer: 'Yes' } } as TimelineEntry;
    expect(replyLabel(ours)).toBeNull();
  });
});
