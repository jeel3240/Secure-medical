import type { QueueTag } from '../api/leads';

/**
 * The queue's STATUS column: a dot and the words.
 *
 * The backend decides *which* status a lead gets - `core/queue-tags.ts`, and
 * `QUEUE.md` says which one wins when several apply. This file only turns that
 * decision into words and a mark.
 *
 * Only three exist - Jeel, 2026-09-28. New, Attempted 2x and Callback 3:00 PM
 * are gone: that history is the working agent's to remember, on My Callbacks
 * and the lead's timeline, and on the home page it gave every row something to
 * say, so nothing stood out. A lead with no status gets a hyphen from the queue
 * page, like any other empty cell.
 *
 * Inbound reply is bold, because a lead has written to us and nobody has read
 * it; Needs review has a warm dot, because a person has to read their replies.
 */

export function tagText(tag: QueueTag): string {
  switch (tag.kind) {
    case 'in_progress':
      // Naming the holder is what stops two agents racing for the same lead.
      // "Working", not "In progress" - Jeel, 2026-09-28: the same word as
      // Admin > Leads, and "In progress" no longer means two things. The
      // `kind` keeps its name; it is the API's, and never shown.
      return tag.agentName ? `Working – ${tag.agentName}` : 'Working';
    case 'inbound_reply':
      return 'Inbound reply';
    case 'needs_review':
      return 'Needs review';
  }
}

/** How loud the words are: strong and alert draw the eye. */
type Tone = 'normal' | 'strong' | 'alert';

const TONE: Record<QueueTag['kind'], Tone> = {
  in_progress: 'normal',
  inbound_reply: 'strong',
  needs_review: 'alert',
};

export function QueueStatus({ tag }: { tag: QueueTag }) {
  return (
    <span className={`status status--${TONE[tag.kind]}`}>
      <span className="status__mark" aria-hidden="true" />
      {tagText(tag)}
    </span>
  );
}
