import type { ReactNode } from 'react';
import type { QueueTag } from '../api/leads';

/**
 * The queue's STATUS column: an icon and the words.
 *
 * The backend decides *which* status a lead gets - `core/queue-tags.ts`, and
 * `QUEUE.md` says which one wins when several apply. This file only turns that
 * decision into words and an icon.
 *
 * Only three exist - Jeel, 2026-09-28. New, Attempted 2x and Callback 3:00 PM
 * are gone: that history is the working agent's to remember, on My Callbacks
 * and the lead's timeline, and on the home page it gave every row something to
 * say, so nothing stood out. A lead with no status gets a hyphen from the queue
 * page, like any other empty cell.
 *
 * **An icon per status, not a dot** - Jeel's mockup, the same day. A dot said
 * only "something"; the icon says what: a half-filled circle for a lead
 * someone is partway through, a message bubble for a text from the lead, a
 * warning triangle for replies a person must read. Drawn in the text colour,
 * so a locked row greys its icon with its words.
 *
 * Inbound reply is also bold, because a lead has written to us and nobody has
 * read it.
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

/** Outline icons on a 24-unit grid, stroked in the text colour like LockIcon. */
const ICONS: Record<QueueTag['kind'], ReactNode> = {
  // Half-filled circle: started, not finished.
  in_progress: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </>
  ),
  // Message box with an arrow pointing in: a text has come to us.
  inbound_reply: (
    <>
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4z" />
      <path d="M16 10H8M11 7l-3 3 3 3" />
    </>
  ),
  // Warning triangle: a person has to look.
  needs_review: (
    <>
      <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
};

export function QueueStatus({ tag }: { tag: QueueTag }) {
  return (
    <span className={`status${tag.kind === 'inbound_reply' ? ' status--strong' : ''}`}>
      <svg
        className={`status__icon status__icon--${tag.kind}`}
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICONS[tag.kind]}
      </svg>
      {tagText(tag)}
    </span>
  );
}
