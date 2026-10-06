/**
 * Wires the pure state machine into the inbound webhook: load the rules and the
 * lead's newest conversation, run `step`, save the result, then send whatever
 * it asked for.
 *
 * Kept out of webhooks.ts so that file stays about the HTTP contract - payload
 * shape, dedupe, status codes - and this one about the flow. STATE-MACHINE.md
 * is the authority for the behaviour.
 */

import { readExpiryDays, type Querier } from '../db/sql';
import type { PoolClient } from 'pg';
import { loadFlow } from '../db/flows';
import { renderMessage } from '../core/messages';
import { step, type Conversation, type GivenAnswer, type Rules, type StepResult } from '../core/state-machine';
import { errText, log } from '../lib/log';

export interface ConversationRow extends Conversation {
  id: number;
  /** The flow the lead is in. Null only on a row from before flows existed that no migration reached. */
  flowId: number | null;
  /** Whether the text the lead has to answer - the question, or its "sorry" - has gone out. */
  questionSent: boolean;
  /** It has not, and not just now: it failed, or was never tried. */
  unsentForLong: boolean;
}

/**
 * How long a text of ours may be on its way before a reply stops being "too
 * soon" and becomes "they are waiting on something that never came". A send
 * gives up after 30 seconds, so this is well clear of one still in flight.
 */
const UNSENT_FOR_LONG = '2 minutes';

/**
 * The newest conversation for a lead, which is the one that drives the flow.
 * Earlier ones are history - see STATE-MACHINE.md, "A number that comes back".
 *
 * Locked with FOR UPDATE, inside the caller's transaction. Two texts sent a
 * moment apart arrive as two requests at once; without the lock both could read
 * the same question, treat their text as the answer to it, and each send the
 * next question - the lead gets it twice and one of their answers is lost. The
 * lock makes the second wait, so it reads the conversation the first one left
 * - which says our next text has not gone out yet, so the second is not taken
 * for an answer to it (`repliedBeforeOurText`, below). It holds one lead's
 * row, so replies from other leads are unaffected.
 */
export async function loadNewestConversation(
  client: PoolClient,
  leadId: number
): Promise<ConversationRow | null> {
  const { rows } = await client.query(
    `SELECT id, flow_id, status, step, current_question_id, invalid_count, score, tier,
            end_outcome, agent_took_over_at,
            question_sent_at IS NOT NULL AS question_sent,
            -- updated_at is when it was put on this question: nothing saves
            -- the conversation again until the text for it has gone.
            (question_sent_at IS NULL AND updated_at < now() - interval '${UNSENT_FOR_LONG}') AS unsent_for_long
     FROM conversations
     WHERE lead_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1
     FOR UPDATE`,
    [leadId]
  );

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    flowId: r.flow_id,
    status: r.status,
    step: r.step,
    currentQuestionId: r.current_question_id,
    invalidCount: r.invalid_count,
    score: r.score,
    tier: r.tier,
    endOutcome: r.end_outcome,
    // Rule 2b: once this is set the state machine stops asking questions.
    agentTookOverAt: r.agent_took_over_at,
    questionSent: r.question_sent,
    unsentForLong: r.unsent_for_long,
  };
}

/**
 * The conversation's flow, the tiers and the clarification limit. Read per
 * reply rather than cached, so a change made by a migration applies to the
 * next reply rather than after a restart. Null when the conversation has no
 * flow to follow.
 */
export async function loadRules(client: PoolClient, flowId: number | null): Promise<Rules | null> {
  if (flowId === null) return null;
  const flow = await loadFlow(client, flowId);
  if (!flow) return null;
  const tiers = await client.query(`SELECT name, min_score, max_score FROM tiers ORDER BY sort_order`);
  const settings = await client.query(
    `SELECT value FROM settings WHERE key = 'max_invalid_before_review'`
  );

  const limit = Number(settings.rows[0]?.value);
  return {
    flow,
    tiers: tiers.rows.map((r) => ({ name: r.name, minScore: r.min_score, maxScore: r.max_score })),
    maxInvalidBeforeReview: Number.isFinite(limit) ? limit : 1,
  };
}

async function saveConversation(
  client: PoolClient,
  id: number,
  c: Conversation,
  /** We now owe the lead a text - a question, or a "sorry". Nothing they send counts until it has gone. */
  textOwed: boolean
): Promise<void> {
  // expires_at is not touched here. It is the window the lead has to reply to a
  // message, so it moves only once that message has actually gone out - see
  // bumpExpiry, called after the send succeeds.
  //
  // completed_at is stamped the first time the conversation is saved as
  // completed - whichever way its flow ended - and kept after: migration 004,
  // for Admin > Overview's "Completed".
  await client.query(
    `UPDATE conversations
     SET status = $2, step = $3, current_question_id = $4,
         invalid_count = $5, score = $6, tier = $7, end_outcome = $8, updated_at = now(),
         completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
         question_sent_at = CASE WHEN $9 THEN NULL ELSE question_sent_at END
     WHERE id = $1`,
    [id, c.status, c.step, c.currentQuestionId, c.invalidCount, c.score, c.tier, c.endOutcome, textOwed]
  );
}

/**
 * Keeps an answer: one row, written once, with the choice's name and points as
 * they are now - so changing the flow later never rewrites what this lead
 * chose or earned. docs/FLOWS.md.
 *
 * `ON CONFLICT DO NOTHING`: a question is answered once in a conversation. The
 * conversation's lock means a second answer cannot get here, and if it ever
 * did, the first stands.
 */
async function saveAnswer(
  client: PoolClient,
  conversationId: number,
  leadId: number,
  a: GivenAnswer,
  /** The inbound text the answer was read from. */
  messageId: number | null
): Promise<void> {
  await client.query(
    `INSERT INTO conversation_answers
       (conversation_id, lead_id, question_id, question_key, position, heading, choice, label, points, message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (conversation_id, question_id) DO NOTHING`,
    [conversationId, leadId, a.questionId, a.questionKey, a.position, a.heading, a.choice, a.label, a.points, messageId]
  );
}

export interface PendingReply {
  /** What the state machine decided. Available before the send happens. */
  result: StepResult;
  /**
   * Sends whatever `result.send` holds, as one text, and records it. Call after
   * committing: see applyReply.
   */
  send: () => Promise<string | null>;
}

/**
 * Applies a reply to the lead's newest conversation.
 *
 * The caller owns the transaction. The database work happens inside it and the
 * send happens after it commits, deliberately: a failed send must not roll back
 * an answer the lead has already given, and a message must never go out on the
 * back of a transaction that later fails.
 *
 * Returns null when the lead has no conversation at all, or one with no flow
 * to follow, which the caller treats as nothing to advance: the message is
 * stored and a person reads it.
 */
export async function applyReply(
  client: PoolClient,
  leadId: number,
  phone: string,
  firstName: string | null,
  /** `messageId`: the stored inbound text, kept with the answer it gives. */
  reply: { text: string; optOut: boolean; messageId?: number }
): Promise<PendingReply | null> {
  const conversation = await loadNewestConversation(client, leadId);
  if (!conversation) return null;

  const rules = await loadRules(client, conversation.flowId);
  if (!rules) {
    // No flow to follow - a row no migration reached. STOP still has to end
    // it: an opt-out can never depend on the state the conversation is in.
    if (reply.optOut && conversation.status === 'open') {
      await client.query(
        `UPDATE conversations SET status = 'suppressed', updated_at = now() WHERE id = $1`,
        [conversation.id]
      );
    }
    return null;
  }

  // A reply before our text - see `repliedBeforeOurText`. Nothing is saved, so
  // `updated_at` still says when the conversation was put on this question.
  if (repliedBeforeOurText(conversation, reply)) {
    log.info('reply.before_our_text', { leadId, forPerson: conversation.unsentForLong });
    return {
      result: {
        conversation,
        send: [],
        blockNumber: false,
        needsPerson: conversation.unsentForLong,
        answer: null,
      },
      send: async () => null,
    };
  }

  const result = step(conversation, reply, rules);

  const textOwed = result.conversation.status === 'open' && result.send.length > 0;
  await saveConversation(client, conversation.id, result.conversation, textOwed);
  if (result.answer) await saveAnswer(client, conversation.id, leadId, result.answer, reply.messageId ?? null);

  // The send is handed back as a closure so the caller can commit first.
  return {
    result,
    send: async () =>
      result.send.length > 0
        ? sendFlowMessage(leadId, conversation.id, phone, firstName, result.send, rules.flow.key)
        : null,
  };
}

/**
 * **A reply before our text is not an answer to it** - Jeel, 2026-10-06.
 *
 * A lead texts "Yes", and a second later "yes" again - a double tap, or they
 * thought the first had not gone. The first answers question 1 and question 2
 * starts on its way. The second arrived while it was still on its way, and was
 * read as the answer to it: question 2 saved as Yes by someone who had not
 * seen it, in a record that cannot be corrected, fifteen points on a score
 * that decides who is called first - and question 3 sent on top of question 2.
 * Two unclear texts in a row did the same to the one "sorry" a lead is
 * allowed, and sent them to a person.
 *
 * So the conversation records when the text the lead has to answer has gone
 * out (`question_sent_at`, cleared whenever we owe them one), and a reply that
 * arrives before then changes nothing: it is kept in the thread, nothing is
 * scored, nothing is sent.
 *
 * If our text has been unsent for a while it is not on its way - it failed, or
 * was never tried - and the lead is waiting on something that will not come.
 * That reply is flagged for a person.
 *
 * Never for an opt-out: STOP works whatever state anything is in. And only for
 * a conversation the questions are still running: a finished or taken-over one
 * is handled by the state machine as before.
 *
 * What it cannot catch: a reply sent a few seconds after our text left, while
 * that text was still on its way to the phone. Nothing here can know.
 */
function repliedBeforeOurText(conversation: ConversationRow, reply: { optOut: boolean }): boolean {
  return (
    !reply.optOut &&
    conversation.status === 'open' &&
    !conversation.agentTookOverAt &&
    conversation.currentQuestionId !== null &&
    !conversation.questionSent
  );
}

/**
 * Restarts the lead's reply window, after a message has actually gone out -
 * and marks that text as sent, so the lead's next reply counts as an answer.
 *
 * Only for a conversation still `open`: a `completed` one is not waiting on the
 * lead, and `suppressed` must never change. The poller does the same thing
 * after the opener, so a message that failed to send never buys the lead
 * another week of silence in either path.
 */
async function bumpExpiry(q: Querier, conversationId: number): Promise<void> {
  const days = await readExpiryDays(q);
  await q.query(
    `UPDATE conversations
     SET expires_at = now() + ($2 || ' days')::interval, question_sent_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'open'`,
    [conversationId, String(days)]
  );
}

/**
 * Sends one message from the flow and records it. Loaded lazily so this module
 * can be imported by tests that never send.
 *
 * A failure is logged and swallowed. The conversation has already advanced, and
 * rolling that back would mean re-asking a question the lead has answered; a
 * missing follow-up is the lesser problem. The refused message is kept as a
 * failed one, so the thread shows it with a red "!" - `db/failed-sends.ts`.
 *
 * **A lead whose text did not go out is flagged for a person** - 2026-10-06,
 * from review. They answered and heard nothing back; the conversation is on a
 * question they never received, nothing retries it, and a lead partway through
 * is not in the queue - so they would sit unseen until they expired, every
 * lead who replied during an EZ Texting outage. The flag puts them in the
 * queue as an inbound reply, with the failed text in their thread. Not for a
 * blocked number: that send was never owed.
 *
 * A failure also leaves `expires_at` where it was, so a lead who was never
 * actually messaged expires on schedule rather than a week late.
 */
async function sendFlowMessage(
  leadId: number,
  conversationId: number,
  phone: string,
  firstName: string | null,
  /** A choice's reply and then the next question, or one message alone. Sent as one text. */
  templates: string[],
  /** For the logs: which flow this text belongs to. */
  flow: string
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pool } = require('../db/pool') as typeof import('../db/pool');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ezt = require('../integrations/ezt-client') as typeof import('../integrations/ezt-client');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sendAndRecord } = require('../db/outbound') as typeof import('../db/outbound');

  try {
    // One text: a reply and the question after it must not arrive out of
    // order, which two sends could. Past 160 characters it is billed as two
    // segments - the Configuration page shows which choices cost that.
    // No length limit, so the name is never dropped to fit one.
    const { text } = renderMessage(templates.join(' '), firstName, Infinity);

    // Recorded around the send so it is never sent twice nor marked refused
    // after it went out - db/outbound.ts.
    const result = await sendAndRecord(pool, {
      leadId,
      body: text,
      send: () => ezt.sendMessage([phone], text),
    });
    if (!result.sent) {
      log.error('sms.failed', { leadId, flow, blocked: result.blocked, err: errText(result.err) });
      if (!result.blocked) await flagForPerson(pool, leadId);
      return null;
    }

    log.info('sms.sent', { leadId, flow, eztMessageId: result.eztMessageId });

    // After the text has gone, and on its own: a failure here must not be
    // logged as a failed send, which it was not.
    try {
      await bumpExpiry(pool, conversationId);
    } catch (err) {
      log.error('conversation.expiry_not_moved', { leadId, err: errText(err) });
    }
    return result.eztMessageId;
  } catch (err) {
    // Before the send: the database refusing the row. Nothing went out.
    log.error('sms.failed', { leadId, flow, err: errText(err) });
    await flagForPerson(pool, leadId).catch(() => undefined);
    return null;
  }
}

/** The lead answered and our text back did not go out: a person has to see them. */
async function flagForPerson(q: Querier, leadId: number): Promise<void> {
  await q.query('UPDATE leads SET has_unread_inbound = true WHERE id = $1', [leadId]);
}
