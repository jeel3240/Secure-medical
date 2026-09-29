import type { QueueTag } from '../api/leads';
import { formatDateTime, formatTime } from '../lib/format';
import { StatusIcon, type StatusIconName } from './StatusIcon';

/**
 * The queue's STATUS column: an icon and the words.
 *
 * The backend decides *which* status a lead gets - `core/queue-tags.ts`, and
 * `QUEUE.md` says which one wins when several apply. This file only turns that
 * decision into words and an icon.
 *
 * Few exist - Jeel, 2026-09-28. New and Attempted 2x are gone (Callback came
 * back the next day, below): that history is the working agent's to remember, on My Callbacks
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
 *
 * **Callback is back - Jeel, 2026-09-29**, naming whose it is: "Callback –
 * Maya Chen · 8:13 PM", with the date as well when it is not today. Without it
 * another agent could pick the lead up and call first.
 */

/** 8:13 PM today, Sep 30, 8:13 PM otherwise. */
function when(iso: string): string {
  const at = new Date(iso);
  return at.toDateString() === new Date().toDateString() ? formatTime(at) : formatDateTime(at);
}

export function tagText(tag: QueueTag): string {
  switch (tag.kind) {
    case 'working':
      // Naming the holder is what stops two agents racing for the same lead.
      // "Working", not "In progress" - Jeel, 2026-09-28: the same word as
      // Admin > Leads. The API's `kind` was renamed to match the same day.
      return tag.agentName ? `Working – ${tag.agentName}` : 'Working';
    case 'inbound_reply':
      return 'Inbound reply';
    case 'callback':
      return `Callback – ${tag.agentName ?? 'an agent'}${tag.at ? ` · ${when(tag.at)}` : ''}`;
    case 'needs_review':
      return 'Needs review';
  }
}

/** The shared icon for each status - `StatusIcon.tsx`. */
const ICON: Record<QueueTag['kind'], StatusIconName> = {
  working: 'half',
  inbound_reply: 'inbound',
  callback: 'clock',
  needs_review: 'warning',
};

export function QueueStatus({ tag }: { tag: QueueTag }) {
  return (
    <span className={`status${tag.kind === 'inbound_reply' ? ' status--strong' : ''}`}>
      <StatusIcon name={ICON[tag.kind]} />
      {tagText(tag)}
    </span>
  );
}
