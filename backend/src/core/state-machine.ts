/**
 * The SMS qualification flow. Pure: no database, no network, so every branch is
 * unit-testable. STATE-MACHINE.md is the authority for the behaviour here and
 * wins over the mockup where they differ.
 *
 * The caller (api/webhooks.ts) loads the lead's newest conversation and the
 * rules, calls `step`, saves the result, then sends whatever `send` names.
 */

import { matchAnswer, type Choice } from './answers';

export type ConversationStatus = 'open' | 'completed' | 'expired' | 'suppressed' | 'review';

export interface Conversation {
  status: ConversationStatus;
  step: number | null;
  q1: string | null;
  q2: string | null;
  q3: string | null;
  invalidCount: number;
  score: number;
  tier: string | null;
  /**
   * When an agent sent the first manual SMS, or null. Set by the agent SMS
   * endpoint, never by this module. Once it is set the questions stop - rule
   * 2b. A timestamp rather than a flag because the timeline shows the moment
   * the handoff happened.
   */
  agentTookOverAt?: Date | string | null;
}

export interface Reply {
  text: string;
  /** From the webhook: the payload flag, or an opt-out keyword. */
  optOut: boolean;
}

/** One row of `scoring_rules`. question 0 is a flat award. */
export interface ScoringRule {
  code: string;
  question: number;
  choice: string | null;
  points: number;
}

/** One row of `tiers`. */
export interface Tier {
  name: string;
  minScore: number;
  maxScore: number;
}

export interface Rules {
  scoring: ScoringRule[];
  tiers: Tier[];
  /** `settings.max_invalid_before_review`, seeded 1. */
  maxInvalidBeforeReview: number;
}

/**
 * Which copy to send, as a `settings` key. The caller renders it with
 * core/messages.ts - the state machine never produces text.
 */
export type MessageKey =
  | 'question_1'
  | 'question_2'
  | 'question_3'
  | 'message_clarify_1'
  | 'message_clarify_2'
  | 'message_clarify_3'
  | 'message_thanks'
  | 'message_review';

export interface StepResult {
  conversation: Conversation;
  send: MessageKey | null;
  /** The caller adds the phone to `dnc_list`. */
  blockNumber: boolean;
}

function points(rules: Rules, code: string): number {
  return rules.scoring.find((r) => r.code === code)?.points ?? 0;
}

/**
 * The tier whose range contains the score. A score of 0 means no reply yet and
 * carries no tier.
 */
export function tierFor(rules: Rules, score: number): string | null {
  if (score <= 0) return null;
  return rules.tiers.find((t) => score >= t.minScore && score <= t.maxScore)?.name ?? null;
}

/**
 * True once any answer is recorded. Used to award `responded` exactly once,
 * however many replies arrive.
 *
 * Read off the conversation rather than a flag column: on the first reply the
 * score is still 0 and no answer is stored, so both are false together.
 */
function hasRespondedBefore(c: Conversation): boolean {
  return c.score > 0;
}

function answerCode(step: number, choice: Choice): string {
  return `q${step}_${choice}`;
}

function withScore(c: Conversation, rules: Rules, score: number): Conversation {
  return { ...c, score, tier: tierFor(rules, score) };
}

/**
 * Applies one inbound reply.
 *
 * The order of the checks is the order in STATE-MACHINE.md, "What a reply
 * does": opt-out first whatever the status, then a conversation that is not
 * open, then a valid answer, then anything else.
 */
export function step(conversation: Conversation, reply: Reply, rules: Rules): StepResult {
  // 1. Opt-out, any status. The number is blocked whatever the conversation was
  // doing. Nothing is sent: EZ Texting sends the unsubscribe confirmation
  // itself, and a second one from us would reach the lead as a duplicate.
  if (reply.optOut) {
    return {
      conversation:
        conversation.status === 'open' ? { ...conversation, status: 'suppressed' } : conversation,
      send: null,
      blockNumber: true,
    };
  }

  // 2. Not open. completed, review, expired and suppressed are final for that
  // conversation: the caller stores the message and flags the lead, and a human
  // picks it up.
  if (conversation.status !== 'open') {
    return { conversation, send: null, blockNumber: false };
  }

  // 2b. An agent has taken the conversation over - Jeel, 2026-09-23. Once an
  // agent has sent a manual SMS the questions stop: the lead is answering the
  // agent, not us, and an automated "Question 2 of 3" landing on top of that
  // reads as a broken system. The reply is stored and the lead is flagged
  // unread by the caller, exactly as in rule 2; nothing is scored and nothing
  // is sent. The score earned so far is kept as it stands.
  //
  // Below rule 1 deliberately: an opt-out can never depend on whether an agent
  // happened to text first.
  if (conversation.agentTookOverAt) {
    return { conversation, send: null, blockNumber: false };
  }

  const current = conversation.step ?? 1;

  // Responding at all earns points, valid answer or not, but only once.
  const respondedAward = hasRespondedBefore(conversation) ? 0 : points(rules, 'responded');
  const choice = matchAnswer(reply.text, current);

  // 4. Unclear. Handled before the valid-answer branch only in the sense that a
  // null choice lands here; the spec's order is preserved because matchAnswer
  // decides which of the two applies.
  if (choice === null) {
    const scored = withScore(conversation, rules, conversation.score + respondedAward);

    if (scored.invalidCount < rules.maxInvalidBeforeReview) {
      return {
        conversation: { ...scored, invalidCount: scored.invalidCount + 1 },
        send: `message_clarify_${current}` as MessageKey,
        blockNumber: false,
      };
    }

    return { conversation: { ...scored, status: 'review' }, send: 'message_review', blockNumber: false };
  }

  // 3. A valid answer. Store it, reset the unclear count - a lead who fumbles
  // one question then answers it should not carry that into the next - and add
  // the answer's points.
  const answered: Conversation = {
    ...conversation,
    invalidCount: 0,
    [`q${current}`]: choice,
  } as Conversation;

  const scoreAfterAnswer =
    conversation.score + respondedAward + points(rules, answerCode(current, choice));

  if (current < 3) {
    const advanced = withScore({ ...answered, step: current + 1 }, rules, scoreAfterAnswer);
    return {
      conversation: advanced,
      send: `question_${current + 1}` as MessageKey,
      blockNumber: false,
    };
  }

  const finished = withScore(
    { ...answered, status: 'completed' },
    rules,
    scoreAfterAnswer + points(rules, 'completed')
  );

  return { conversation: finished, send: 'message_thanks', blockNumber: false };
}
