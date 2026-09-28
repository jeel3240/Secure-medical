/**
 * The sent tick - Jeel, 2026-09-28. One tick on every message we sent that did
 * not fail; none on the lead's own messages. One rather than two because
 * nothing tells us a text reached the phone - Conversation.tsx, SentTick.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TimelineEntry } from '../../api/workspace';
import { Conversation } from './Conversation';

// jsdom has no layout, so the scroll-into-view on new messages is a no-op here.
Element.prototype.scrollIntoView = () => {};

const entry = (kind: TimelineEntry['kind'], body: string, deliveryStatus?: string): TimelineEntry =>
  ({ kind, at: '2026-09-28T10:00:00Z', author: 'karm', detail: { body, deliveryStatus } }) as TimelineEntry;

const renderThread = (entries: TimelineEntry[]) =>
  render(<Conversation entries={entries} chips={[]} leadFirstName="Ruby" />);

describe('the sent tick', () => {
  it('marks an automated message and an agent message as sent', () => {
    renderThread([entry('sms', 'Question 1'), entry('agent_sms', 'Hi Ruby')]);
    expect(screen.getAllByRole('img', { name: 'Sent' })).toHaveLength(2);
  });

  it('is never on the lead’s own message', () => {
    renderThread([entry('inbound', 'hello')]);
    expect(screen.queryByRole('img', { name: 'Sent' })).toBeNull();
  });

  it('is not on a message that failed - that says "delivery failed" instead', () => {
    renderThread([entry('agent_sms', 'Hi Ruby', 'failed')]);
    expect(screen.queryByRole('img', { name: 'Sent' })).toBeNull();
    expect(screen.getByText(/delivery failed/)).toBeTruthy();
  });

  it('is one tick, not two', () => {
    const { container } = renderThread([entry('agent_sms', 'Hi Ruby')]);
    expect(container.querySelectorAll('.convo__tick path')).toHaveLength(1);
  });
});
