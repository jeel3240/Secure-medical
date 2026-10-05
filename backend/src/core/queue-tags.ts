/**
 * The status an agent sees against a lead in the queue.
 *
 * Pure: the caller passes the facts, this decides. Statuses are computed,
 * never stored, so they stay true as conversations advance - CLAUDE.md §6.
 *
 * The shape is structured rather than a finished string: the API returns what
 * is true, the screen decides how to word it ("Working – Michael"). That
 * keeps wording changes out of the backend.
 *
 * **Few, and most rows have none** - Jeel, 2026-09-28. The queue once
 * also said New, Attempted 2x and Callback 3:00 PM. That history belongs to the
 * agent working the lead - their callbacks are on My Callbacks, every call is
 * in the lead's timeline - and on the home page it made every row say
 * something, so nothing stood out. What is left answers the two questions an
 * agent scanning the queue actually has: is somebody already on this, and why
 * is it here? A lead with no status is simply waiting to be picked up.
 *
 * **Callback came back, naming whose it is - Jeel, 2026-09-29.** A lead
 * waiting on a callback sat in the queue saying nothing, so another agent could
 * pick it up and call first, not knowing Maya had promised to at 8:13. It now
 * says "Callback – Maya Chen · 8:13 PM": whose call it is, answering the same
 * question as Working - is somebody already on this?
 */

/**
 * `working` was `in_progress` until 2026-09-28: the screen says "Working –
 * name", and one state with two names was one more thing to translate.
 */
export type QueueTagKind = 'working' | 'missed_call' | 'inbound_reply' | 'callback' | 'needs_review';

export interface QueueTag {
  kind: QueueTagKind;
  /**
   * `working`: who holds it - the id to compare with, the name to show.
   * `callback`: whose callback it is.
   */
  agentId?: number;
  agentName?: string;
  /** `callback`: when it is due, ISO. */
  at?: string;
}

export interface QueueFacts {
  conversationStatus: 'open' | 'completed' | 'review' | 'expired';
  /** The active agent holding the lead, if any. */
  holder: { id: number; name: string } | null;
  hasUnreadInbound: boolean;
  /** The lead rang us, nobody answered, and nobody has called or texted back since. */
  missedCall?: boolean;
  /** The earliest callback not yet done, if any. */
  nextCallback?: { agentId: number; agentName: string; at: string } | null;
}

/**
 * Only one status is shown per row, so the order here is the order of urgency:
 *
 * 1. someone already has it - nobody else should call;
 * 2. the lead rang us and nobody answered - they want to talk now, which
 *    outranks a text waiting to be read (2026-10-01);
 * 3. the lead has texted and nobody has read it;
 * 4. an agent has promised to call - it is theirs;
 * 5. their replies could not be understood, so a person must read them.
 *
 * Otherwise `null`: nothing to say, the lead is waiting.
 */
export function queueTag(facts: QueueFacts): QueueTag | null {
  if (facts.holder) {
    return { kind: 'working', agentId: facts.holder.id, agentName: facts.holder.name };
  }

  if (facts.missedCall) {
    return { kind: 'missed_call' };
  }

  if (facts.hasUnreadInbound) {
    return { kind: 'inbound_reply' };
  }

  if (facts.nextCallback) {
    const { agentId, agentName, at } = facts.nextCallback;
    return { kind: 'callback', agentId, agentName, at };
  }

  if (facts.conversationStatus === 'review') {
    return { kind: 'needs_review' };
  }

  return null;
}
