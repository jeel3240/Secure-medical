/**
 * The tag an agent sees against a lead in the queue.
 *
 * Pure: the caller passes the facts, this decides. Tags are computed, never
 * stored, so they stay true as conversations advance, calls happen and
 * callbacks are set - CLAUDE.md §6.
 *
 * The shape is structured rather than a finished string: the API returns what
 * is true, the screen decides how to word it ("In progress - Michael",
 * "Callback 3:00 PM"). That keeps wording changes out of the backend.
 */

export type QueueTagKind =
  | 'in_progress'
  | 'callback'
  | 'inbound_reply'
  | 'needs_review'
  | 'stalled'
  | 'attempted'
  | 'new';

export interface QueueTag {
  kind: QueueTagKind;
  /** `in_progress`: who holds it. */
  agentName?: string;
  /** `callback`: when it is due. */
  callbackAt?: string;
  /** `attempted`: how many calls have been made. */
  attempts?: number;
  /** `stalled`: how many questions they answered before going quiet, so 1 or 2
   *  - the screen writes it as "Stalled at Q1" / "Stalled at Q2". */
  step?: number;
}

export interface QueueFacts {
  conversationStatus: 'open' | 'completed' | 'review' | 'expired';
  /** The lead's answers so far; null where unanswered. */
  answers: [string | null, string | null, string | null];
  assignedAgentName: string | null;
  hasUnreadInbound: boolean;
  callCount: number;
  /** The soonest callback still to be done, if any. */
  nextCallbackAt: string | null;
}

/**
 * Only one tag is shown per row, so the order here is the order of urgency to
 * an agent scanning the queue:
 *
 * 1. someone already has it - nobody else should call;
 * 2. a callback is booked - that commitment outranks anything else;
 * 3. the lead has texted and nobody has read it;
 * 4. their replies could not be understood, so a human must read them;
 * 5. they answered some questions and went quiet;
 * 6. we have called and not reached them;
 * 7. nothing has happened yet.
 */
export function queueTag(facts: QueueFacts): QueueTag {
  if (facts.assignedAgentName) {
    return { kind: 'in_progress', agentName: facts.assignedAgentName };
  }

  if (facts.nextCallbackAt) {
    return { kind: 'callback', callbackAt: facts.nextCallbackAt };
  }

  if (facts.hasUnreadInbound) {
    return { kind: 'inbound_reply' };
  }

  if (facts.conversationStatus === 'review') {
    return { kind: 'needs_review' };
  }

  // Partway through and still waiting on them. Only `open` counts: an expired
  // conversation is closed and its lead has left the queue, so "stalled"
  // applies to live conversations only - STATE-MACHINE.md, "Expiry".
  const answered = facts.answers.filter((a) => a !== null).length;
  if (facts.conversationStatus === 'open' && answered > 0 && answered < 3) {
    return { kind: 'stalled', step: answered };
  }

  if (facts.callCount > 0) {
    return { kind: 'attempted', attempts: facts.callCount };
  }

  return { kind: 'new' };
}
