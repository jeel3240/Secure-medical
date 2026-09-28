/**
 * The queue's status marks. Shape carries the meaning - filled for something
 * happening, a ring for something waiting, a square for a past attempt - and
 * only two statuses raise their voice: Inbound reply in bold, Needs review in
 * colour. Those are the ones a person must get to first.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QueueTag } from '../api/leads';
import { QueueStatus, tagText } from './QueueStatus';
import { TierSignal } from './TierSignal';

const renderTag = (tag: QueueTag) => {
  const { container } = render(<QueueStatus tag={tag} />);
  const status = container.querySelector('.status')!;
  const mark = container.querySelector('.status__mark')!;
  return {
    text: status.textContent,
    tone: [...status.classList].find((c) => c.startsWith('status--'))?.replace('status--', ''),
    mark: [...mark.classList].find((c) => c.startsWith('status__mark--'))?.replace('status__mark--', ''),
  };
};

describe('status marks', () => {
  it.each<[string, QueueTag, string, string, string]>([
    ['someone working it', { kind: 'in_progress', agentName: 'karm' }, 'In progress – karm', 'dot', 'normal'],
    ['a callback booked', { kind: 'callback' }, 'Callback', 'ring', 'normal'],
    ['an unread reply', { kind: 'inbound_reply' }, 'Inbound reply', 'dot', 'strong'],
    ['replies nobody understood', { kind: 'needs_review' }, 'Needs review', 'dot', 'alert'],
    ['called and not reached', { kind: 'attempted', attempts: 2 }, 'Attempted 2x', 'square', 'muted'],
    ['nothing yet', { kind: 'new' }, 'New', 'ring', 'muted'],
  ])('%s', (_, tag, text, mark, tone) => {
    expect(renderTag(tag)).toEqual({ text, mark, tone });
  });

  it('only the two statuses that need a person first stand out', () => {
    const loud = (['in_progress', 'callback', 'inbound_reply', 'needs_review', 'attempted', 'new'] as const)
      .filter((kind) => ['strong', 'alert'].includes(renderTag({ kind } as QueueTag).tone!));
    expect(loud).toEqual(['inbound_reply', 'needs_review']);
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
