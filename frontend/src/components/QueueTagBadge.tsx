import type { QueueTag } from '../api/leads';
import { Badge } from './Badge';

/**
 * The STATUS column's tag.
 *
 * The backend decides *which* tag a lead gets - `core/queue-tags.ts`, and
 * `QUEUE.md` says which one wins when several apply. This file only turns that
 * decision into words and a colour, the same way the queue tags were always
 * specified: computed from the data, never stored as a status.
 *
 * DESIGN-PROMPT.md 2.
 */

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** `Callback 3:30 PM` today, `Callback Mar 4` beyond it. */
function callbackWhen(iso: string | undefined, now = new Date()): string {
  if (!iso) return 'Callback';
  const at = new Date(iso);
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();

  return sameDay
    ? `Callback ${timeFormat.format(at)}`
    : `Callback ${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function tagText(tag: QueueTag): string {
  switch (tag.kind) {
    case 'in_progress':
      // Naming the holder is what stops two agents racing for the same lead.
      return tag.agentName ? `In progress - ${tag.agentName}` : 'In progress';
    case 'callback':
      return callbackWhen(tag.callbackAt);
    case 'inbound_reply':
      return 'Inbound reply';
    case 'needs_review':
      return 'Needs review';
    case 'stalled':
      return tag.step ? `Stalled at Q${tag.step}` : 'Stalled';
    case 'attempted':
      return `Attempted ${tag.attempts ?? 1}x`;
    case 'new':
    default:
      return 'New';
  }
}

const TONE: Record<QueueTag['kind'], 'neutral' | 'navy' | 'success' | 'muted' | 'warning'> = {
  new: 'success',
  inbound_reply: 'warning',
  needs_review: 'warning',
  callback: 'navy',
  // Muted, because the row it sits on is muted too: this lead is someone
  // else's and the colour should not invite a click.
  in_progress: 'muted',
  attempted: 'neutral',
  stalled: 'neutral',
};

export function QueueTagBadge({ tag }: { tag: QueueTag }) {
  return (
    <Badge tone={TONE[tag.kind]} dot={tag.kind === 'inbound_reply'}>
      {tagText(tag)}
    </Badge>
  );
}
