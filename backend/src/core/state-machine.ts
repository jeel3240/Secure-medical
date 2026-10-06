/**
 * The SMS qualification flow. Pure: no database, no network, so every branch is
 * unit-testable. STATE-MACHINE.md is the authority for the behaviour here and
 * wins over the mockup where they differ.
 *
 * **It runs any flow** - Jeel, 2026-10-05, docs/FLOWS.md. Until then it knew
 * one script: three questions, three choices each. A flow is now data - its
 * questions, each question's choices, and for each choice the reply, the
 * points and where the lead goes next - and this module only follows it. A
 * flow with two questions or five, with a branch or without, is the same code.
 *
 * The caller (api/reply-flow.ts) loads the lead's newest conversation and its
 * flow, calls `step`, saves the result, then sends whatever `send` holds.
 */

import { matchChoice } from './answers';

export type ConversationStatus = 'open' | 'completed' | 'expired' | 'suppressed' | 'review';

/**
 * How a flow ended, from the choice that ended it:
 * - `completed`: the questions are answered. Agents call, by score.
 * - `offers`: wants offers only. Not for agents.
 * - `wants_contact`: asked to hear from a rep. Agents call.
 */
export type Ending = 'completed' | 'offers' | 'wants_contact';

export interface FlowChoice {
  /** What the lead types: '1'. */
  choice: string;
  /** What the screens show: 'Talk to an agent'. */
  label: string;
  words: readonly string[];
  points: number;
  /** Sent on this answer, in front of the next question when there is one. */
  reply: string | null;
  /** Where the lead goes next; null when this choice ends the flow. */
  nextQuestionId: number | null;
  ending: Ending | null;
}

export interface FlowQuestion {
  id: number;
  /** 'q1', 'offers'. */
  key: string;
  /** Display order; the lowest is the first question. */
  position: number;
  /** As the lead reads it. May contain {first_name}. */
  body: string;
  /** Sent when the reply is none of the choices. */
  clarifyBody: string;
  /** What the screens call this answer. */
  heading: string;
  choices: readonly FlowChoice[];
}

export interface Flow {
  id: number;
  key: string;
  /** Awarded once, on the first reply of any kind. */
  respondedPoints: number;
  /** Awarded when the flow ends `completed`. */
  completedPoints: number;
  /** Sent after too many unclear replies, when a person takes over. */
  reviewBody: string;
  questions: readonly FlowQuestion[];
}

export interface Conversation {
  status: ConversationStatus;
  /** The current question's position, for screens that say "On Q2". */
  step: number | null;
  /** The question the lead is on. Null once the conversation is not open. */
  currentQuestionId: number | null;
  invalidCount: number;
  score: number;
  tier: string | null;
  endOutcome: Ending | null;
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

/** One row of `tiers`. */
export interface Tier {
  name: string;
  minScore: number;
  maxScore: number;
}

export interface Rules {
  flow: Flow;
  tiers: Tier[];
  /** `settings.max_invalid_before_review`, seeded 1. */
  maxInvalidBeforeReview: number;
}

/** An answer this reply gave: what the caller writes to `conversation_answers`. */
export interface GivenAnswer {
  questionId: number;
  questionKey: string;
  position: number;
  heading: string;
  choice: string;
  label: string;
  points: number;
}

export interface StepResult {
  conversation: Conversation;
  /**
   * What to send, in order, as one text: a choice's reply and then the next
   * question, or a clarification alone. Templates - the caller fills in
   * {first_name}. Empty when nothing is sent.
   */
  send: string[];
  /** The caller adds the phone to `dnc_list`. */
  blockNumber: boolean;
  /**
   * The reply is not something the questions can handle, so a person has to
   * read it: the caller sets `leads.has_unread_inbound`, which is what the
   * queue shows as Inbound reply. True only for rules 2 and 2b - a message
   * after the conversation ended, or to an agent who took it over. An answer,
   * an unclear reply and an opt-out are all handled here, and flagging them
   * made every responder read as an inbound reply. Jeel, 2026-09-28.
   */
  needsPerson: boolean;
  /** The answer this reply gave, or null when it gave none. */
  answer: GivenAnswer | null;
}

/**
 * The tier whose range contains the score. A score of 0 means no reply yet and
 * carries no tier.
 */
export function tierFor(rules: Pick<Rules, 'tiers'>, score: number): string | null {
  if (score <= 0) return null;
  return rules.tiers.find((t) => score >= t.minScore && score <= t.maxScore)?.name ?? null;
}

/** The question a new lead is sent: the one with the lowest position. */
export function firstQuestion(flow: Flow): FlowQuestion | null {
  return [...flow.questions].sort((a, b) => a.position - b.position)[0] ?? null;
}

/**
 * True once any reply has been scored. Used to award `respondedPoints` exactly
 * once, however many replies arrive: on the first reply the score is still 0.
 */
function hasRespondedBefore(c: Conversation): boolean {
  return c.score > 0;
}

function withScore(c: Conversation, rules: Rules, score: number): Conversation {
  return { ...c, score, tier: tierFor(rules, score) };
}

const nothing = (conversation: Conversation, over: Partial<StepResult> = {}): StepResult => ({
  conversation,
  send: [],
  blockNumber: false,
  needsPerson: false,
  answer: null,
  ...over,
});

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
    return nothing(
      conversation.status === 'open'
        ? { ...conversation, status: 'suppressed', currentQuestionId: null }
        : conversation,
      { blockNumber: true }
    );
  }

  // 2. Not open. completed, review, expired and suppressed are final for that
  // conversation: the caller stores the message and flags the lead, and a
  // person picks it up.
  if (conversation.status !== 'open') {
    return nothing(conversation, { needsPerson: true });
  }

  // 2b. An agent has taken the conversation over - Jeel, 2026-09-23. Once an
  // agent has sent a manual SMS the questions stop: the lead is answering the
  // agent, not us, and an automated question landing on top of that reads as a
  // broken system. The reply is stored and the lead is flagged unread by the
  // caller, exactly as in rule 2; nothing is scored and nothing is sent. The
  // score earned so far is kept as it stands.
  //
  // Below rule 1 deliberately: an opt-out can never depend on whether an agent
  // happened to text first.
  if (conversation.agentTookOverAt) {
    return nothing(conversation, { needsPerson: true });
  }

  const { flow } = rules;
  const question = flow.questions.find((q) => q.id === conversation.currentQuestionId);
  // An open conversation with no question it could be on - a flow edited from
  // under it. Nothing here can answer the lead, so a person does.
  if (!question) {
    return nothing(conversation, { needsPerson: true });
  }

  // Responding at all earns points, valid answer or not, but only once.
  const respondedAward = hasRespondedBefore(conversation) ? 0 : flow.respondedPoints;
  const chosen = matchChoice(reply.text, question.choices);

  // 4. Unclear: the reply is none of this question's choices.
  if (chosen === null) {
    const scored = withScore(conversation, rules, conversation.score + respondedAward);

    if (scored.invalidCount < rules.maxInvalidBeforeReview) {
      return nothing(
        { ...scored, invalidCount: scored.invalidCount + 1 },
        { send: [question.clarifyBody] }
      );
    }

    // Not flagged: the review status is what brings this lead to a person, and
    // Inbound reply would outrank Needs review and hide why.
    return nothing({ ...scored, status: 'review', currentQuestionId: null }, { send: [flow.reviewBody] });
  }

  // 3. A valid answer. Record it, reset the unclear count - a lead who fumbles
  // one question then answers it should not carry that into the next - and add
  // the answer's points.
  const answer: GivenAnswer = {
    questionId: question.id,
    questionKey: question.key,
    position: question.position,
    heading: question.heading,
    choice: chosen.choice,
    label: chosen.label,
    points: chosen.points,
  };
  const scoreAfterAnswer = conversation.score + respondedAward + chosen.points;
  const reply_ = chosen.reply ? [chosen.reply] : [];

  const next = flow.questions.find((q) => q.id === chosen.nextQuestionId);
  if (next) {
    return {
      conversation: withScore(
        { ...conversation, invalidCount: 0, currentQuestionId: next.id, step: next.position },
        rules,
        scoreAfterAnswer
      ),
      // The reply and the next question go out as one text, so they cannot
      // arrive out of order.
      send: [...reply_, next.body],
      blockNumber: false,
      needsPerson: false,
      answer,
    };
  }

  // The choice ends the flow. A choice that names a next question the flow no
  // longer has ends it too, as completed: the lead has answered what exists.
  const ending: Ending = chosen.ending ?? 'completed';
  const finished = withScore(
    { ...conversation, invalidCount: 0, status: 'completed', currentQuestionId: null, endOutcome: ending },
    rules,
    scoreAfterAnswer + (ending === 'completed' ? flow.completedPoints : 0)
  );
  return { conversation: finished, send: reply_, blockNumber: false, needsPerson: false, answer };
}
