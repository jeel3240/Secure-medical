import type { QueueTag } from '../api/leads';

/**
 * The queue's STATUS column: a small mark and the words.
 *
 * The backend decides *which* tag a lead gets - `core/queue-tags.ts`, and
 * `QUEUE.md` says which one wins when several apply. This file only turns that
 * decision into words and a mark, computed from the data, never stored.
 *
 * Redesigned 2026-09-28 to Jeel's mockup: coloured pills made every row shout,
 * so a column of them read as noise. Now the mark's shape carries the meaning -
 * a filled dot for something happening, a ring for something waiting, a square
 * for a past attempt - and colour is kept for the one status a person must act
 * on before anything else. Inbound reply is the other exception: bold, because
 * a lead has written to us and nobody has read it.
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
      return tag.agentName ? `In progress – ${tag.agentName}` : 'In progress';
    case 'callback':
      return callbackWhen(tag.callbackAt);
    case 'inbound_reply':
      return 'Inbound reply';
    case 'needs_review':
      return 'Needs review';
    case 'attempted':
      return `Attempted ${tag.attempts ?? 1}x`;
    case 'new':
    default:
      return 'New';
  }
}

type Mark = 'dot' | 'ring' | 'square';
/** How loud the words are: strong and alert draw the eye, muted steps back. */
type Tone = 'strong' | 'normal' | 'alert' | 'muted';

const LOOK: Record<QueueTag['kind'], { mark: Mark; tone: Tone }> = {
  in_progress: { mark: 'dot', tone: 'normal' },
  callback: { mark: 'ring', tone: 'normal' },
  inbound_reply: { mark: 'dot', tone: 'strong' },
  needs_review: { mark: 'dot', tone: 'alert' },
  attempted: { mark: 'square', tone: 'muted' },
  new: { mark: 'ring', tone: 'muted' },
};

export function QueueStatus({ tag }: { tag: QueueTag }) {
  const { mark, tone } = LOOK[tag.kind];
  return (
    <span className={`status status--${tone}`}>
      <span className={`status__mark status__mark--${mark}`} aria-hidden="true" />
      {tagText(tag)}
    </span>
  );
}
