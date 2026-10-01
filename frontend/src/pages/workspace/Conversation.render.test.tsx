/**
 * The sent ticks and the not-sent mark - Jeel, 2026-09-28. Two ticks on every
 * message EZ Texting accepted; a red "!" beside one it refused; neither on the
 * lead's own messages. Conversation.tsx says what the ticks mean.
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

describe('the sent ticks', () => {
  it('marks an automated message and an agent message as sent', () => {
    renderThread([entry('sms', 'Question 1'), entry('agent_sms', 'Hi Ruby')]);
    expect(screen.getAllByRole('img', { name: 'Sent' })).toHaveLength(2);
  });

  it('is never on the lead’s own message', () => {
    renderThread([entry('inbound', 'hello')]);
    expect(screen.queryByRole('img', { name: 'Sent' })).toBeNull();
  });

  it('are two ticks', () => {
    const { container } = renderThread([entry('agent_sms', 'Hi Ruby')]);
    expect(container.querySelectorAll('.convo__tick path')).toHaveLength(2);
  });
});

describe('a message EZ Texting refused', () => {
  it('has a red "!" beside it and no ticks', () => {
    renderThread([entry('agent_sms', 'Hi Ruby', 'failed')]);
    expect(screen.getByRole('img', { name: 'Not sent' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Sent' })).toBeNull();
  });

  it('is marked the same way when it was an automated message', () => {
    renderThread([entry('sms', 'Question 2', 'failed')]);
    expect(screen.getByRole('img', { name: 'Not sent' })).toBeTruthy();
  });

  it('leaves messages that went out unmarked', () => {
    renderThread([entry('sms', 'Question 1')]);
    expect(screen.queryByRole('img', { name: 'Not sent' })).toBeNull();
  });
});

describe('a call in the thread - Phase 4', () => {
  it('is a quiet line saying how it went and who placed it, not a bubble', () => {
    const call = { kind: 'call', at: '2026-09-28T10:00:00Z', author: 'Maya Chen', detail: { outcome: 'no_answer', durationSec: 0 } } as TimelineEntry;
    const { container } = renderThread([entry('sms', 'Question 1'), call]);
    const line = container.querySelector('.convo__system');
    expect(line?.textContent).toMatch(/^Outbound call · no answer · Maya Chen · /);
    expect(screen.getAllByRole('img', { name: 'Sent' })).toHaveLength(1);
  });
});

