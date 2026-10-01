/**
 * The queue's statuses: only three, each an icon and the words - Jeel,
 * 2026-09-28. The icon says which status it is; Inbound reply is also bold,
 * because a lead has written to us and nobody has read it.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QueueTag } from '../api/leads';
import { QueueStatus, tagText } from './QueueStatus';
import { TierSignal } from './TierSignal';

const renderTag = (tag: QueueTag) => {
  const { container } = render(<QueueStatus tag={tag} />);
  const status = container.querySelector('.status')!;
  const icon = container.querySelector('svg.status__icon');
  return {
    text: status.textContent,
    icon: [...(icon?.classList ?? [])].find((c) => c.startsWith('status__icon--'))?.replace('status__icon--', ''),
    bold: status.classList.contains('status--strong'),
  };
};

describe('statuses', () => {
  it.each<[string, QueueTag, string, string, boolean]>([
    ['someone working it', { kind: 'working', agentId: 2, agentName: 'karm' }, 'Working – karm', 'half', false],
    ['an unread reply', { kind: 'inbound_reply' }, 'Inbound reply', 'inbound', true],
    ['a call nobody answered', { kind: 'missed_call' }, 'Missed call', 'missed', true],
    ['replies nobody understood', { kind: 'needs_review' }, 'Needs review', 'warning', false],
    ['a callback booked', { kind: 'callback', agentId: 21, agentName: 'Maya Chen' }, 'Callback – Maya Chen', 'clock', false],
  ])('%s: its own icon, and the words', (_, tag, text, icon, bold) => {
    expect(renderTag(tag)).toEqual({ text, icon, bold });
  });

  it('draws no dot any more', () => {
    const { container } = render(<QueueStatus tag={{ kind: 'needs_review' }} />);
    expect(container.querySelector('.status__mark')).toBeNull();
  });

  it('gives a callback today just the time, and another day the date too', () => {
    const today = new Date();
    today.setHours(20, 13, 0, 0);
    expect(tagText({ kind: 'callback', agentName: 'Maya Chen', at: today.toISOString() })).toMatch(
      /^Callback – Maya Chen · 8:13\sPM$/
    );
    const later = new Date(today);
    later.setDate(later.getDate() + 3);
    expect(tagText({ kind: 'callback', agentName: 'Maya Chen', at: later.toISOString() })).toMatch(
      /^Callback – Maya Chen · [A-Z][a-z]{2} \d{1,2}, 8:13\sPM$/
    );
  });

  it('names the holder with an en dash, as drawn', () => {
    expect(tagText({ kind: 'working', agentId: 2, agentName: 'karm' })).toBe('Working – karm');
  });
});

describe('tier signal', () => {
  it.each([
    ['HOT', 3, 'Hot'],
    ['WARM', 2, 'Warm'],
    ['LOW', 1, 'Low'],
  ])('%s lights %i of 3 bars and says %s', (tier, lit, word) => {
    const { container } = render(<TierSignal tier={tier} />);
    expect(container.querySelectorAll('.tier-signal__bar')).toHaveLength(3);
    expect(container.querySelectorAll('.tier-signal__bar--on')).toHaveLength(lit);
    expect(container.textContent).toBe(word);
  });

  it('shows a hyphen when there is no tier', () => {
    const { container } = render(<TierSignal tier={null} />);
    expect(container.textContent).toBe('-');
    expect(container.querySelector('svg')).toBeNull();
  });
});
