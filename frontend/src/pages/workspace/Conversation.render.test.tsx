/**
 * The sent ticks and the not-sent mark - Jeel, 2026-09-28. Two ticks on every
 * message EZ Texting accepted; a red "!" beside one it refused; neither on the
 * lead's own messages. Conversation.tsx says what the ticks mean.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineEntry } from '../../api/workspace';
import { Conversation } from './Conversation';

// jsdom has no layout, so the scroll-into-view on new messages is a no-op here.
Element.prototype.scrollIntoView = () => {};

const entry = (kind: TimelineEntry['kind'], body: string, deliveryStatus?: string): TimelineEntry =>
  ({ kind, at: '2026-09-28T10:00:00Z', author: 'karm', detail: { body, deliveryStatus } }) as TimelineEntry;

const renderThread = (entries: TimelineEntry[]) =>
  render(<Conversation entries={entries} leadFirstName="Ruby" />);

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

  it('the robot\'s call says how it ended, names who took it once, and keeps what the lead said folded under it (T21)', () => {
    const robot = {
      kind: 'call',
      at: '2026-09-28T10:00:00Z',
      author: 'Maya Chen',
      detail: {
        direction: 'automated',
        outcome: 'answered',
        durationSec: 134,
        scriptResult: 'transferred',
        answers: [{ question: 'Q1', attempt: 1, heard: 'yeah sure', keys: null, result: 'choice', choice: 'Yes' }],
      },
    } as TimelineEntry;
    const { container } = renderThread([robot]);
    expect(container.querySelector('.convo__system')?.textContent).toMatch(/^Automated call · said yes · Maya Chen took it · 2:14 · \d/);
    expect(container.querySelector('details summary')?.textContent).toBe('Answers');
    expect(screen.getByText('Q1 · "yeah sure" → Yes')).toBeDefined();
  });
});


describe('a label wherever the day changes - W1', () => {
  // 18 Oct 2026, a Sunday, 3 PM local time. Local dates, so the test holds in
  // any time zone.
  const local = (month: number, day: number, hour: number, minute = 0) =>
    new Date(2026, month - 1, day, hour, minute).toISOString();
  const at = (kind: TimelineEntry['kind'], when: string, body = 'hi'): TimelineEntry =>
    ({ kind, at: when, author: 'Chris', detail: { body, outcome: 'voicemail', durationSec: 0 } }) as TimelineEntry;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 15, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The thread's children in order: the day labels by their words, everything else as "item". */
  const order = (container: HTMLElement) =>
    [...(container.querySelector('.convo')?.children ?? [])]
      .filter((el) => el.tagName !== 'DIV' || el.className !== '')
      .map((el) => (el.classList.contains('convo__day') ? el.textContent : 'item'));

  it('puts one label before the first item of each day, and none between items of the same day', () => {
    const { container } = renderThread([
      at('inbound', local(10, 14, 12, 48), '1'),
      at('sms', local(10, 14, 12, 48), 'Great. Start your online consultation'),
      at('call', local(10, 17, 14, 40)),
      at('call', local(10, 18, 14, 41)),
      at('agent_sms', local(10, 18, 14, 43), 'Hi David'),
    ]);
    expect(order(container)).toEqual(['Wed, Oct 14', 'item', 'item', 'Yesterday', 'item', 'Today', 'item', 'item']);
  });

  it('shows a single label for a thread of one day', () => {
    const { container } = renderThread([at('sms', local(10, 18, 9)), at('inbound', local(10, 18, 9, 5))]);
    expect([...container.querySelectorAll('.convo__day')].map((el) => el.textContent)).toEqual(['Today']);
  });

  it('keeps each item’s own time', () => {
    const { container } = renderThread([at('agent_sms', local(10, 18, 14, 43), 'Hi David')]);
    expect(container.querySelector('.convo__meta')?.textContent).toMatch(/^Chris · 2:43\sPM$/);
  });
});
