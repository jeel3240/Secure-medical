/**
 * The queue's statuses: only three, each a dot and the words - Jeel,
 * 2026-09-28. Two raise their voice: Inbound reply in bold, Needs review with a
 * warm dot. Those are the ones a person must get to first.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QueueTag } from '../api/leads';
import { QueueStatus, tagText } from './QueueStatus';
import { TierSignal } from './TierSignal';

const renderTag = (tag: QueueTag) => {
  const { container } = render(<QueueStatus tag={tag} />);
  const status = container.querySelector('.status')!;
  return {
    text: status.textContent,
    tone: [...status.classList].find((c) => c.startsWith('status--'))?.replace('status--', ''),
  };
};

describe('statuses', () => {
  it.each<[string, QueueTag, string, string]>([
    ['someone working it', { kind: 'in_progress', agentName: 'karm' }, 'In progress – karm', 'normal'],
    ['an unread reply', { kind: 'inbound_reply' }, 'Inbound reply', 'strong'],
    ['replies nobody understood', { kind: 'needs_review' }, 'Needs review', 'alert'],
  ])('%s', (_, tag, text, tone) => {
    expect(renderTag(tag)).toEqual({ text, tone });
  });

  it('names the holder with an en dash, as drawn', () => {
    expect(tagText({ kind: 'in_progress', agentName: 'karm' })).toBe('In progress – karm');
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
