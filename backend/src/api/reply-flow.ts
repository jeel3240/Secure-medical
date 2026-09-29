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
import { renderMessage } from '../core/messages';
import {
  step,
  type Conversation,
  type MessageKey,
  type Rules,
  type StepResult,
} from '../core/state-machine';
import { errText, log } from '../lib/log';

export interface ConversationRow extends Conversation {
  id: number;
}

/**
 * The newest conversation for a lead, which is the one that drives the flow.
 * Earlier ones are history - see STATE-MACHINE.md, "A number that comes back".
 *
 * Locked with FOR UPDATE, inside the caller's transaction. Two texts sent a
 * moment apart arrive as two requests at once; without the lock both could read
 * the same step, treat their text as the answer to it, and each send the next
 * question - the lead gets it twice and one of their answers is lost. The lock
 * makes the second wait, so it reads the conversation the first one left and
 * answers the question the lead is actually on. It holds one lead's row, so
 * replies from other leads are unaffected.
 */
export async function loadNewestConversation(
  client: PoolClient,
  leadId: number
): Promise<ConversationRow | null> {
  const { rows } = await client.query(
    `SELECT id, status, step, q1, q2, q3, invalid_count, score, tier, agent_took_over_at
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
    status: r.status,
    step: r.step,
    q1: r.q1,
    q2: r.q2,
    q3: r.q3,
    invalidCount: r.invalid_count,
    score: r.score,
    tier: r.tier,
    // Rule 2b: once this is set the state machine stops asking questions.
    agentTookOverAt: r.agent_took_over_at,
  };
}

/**
 * Scoring rules, tiers and the clarification limit. Read per reply rather than
 * cached: all three are admin-editable, and a change should apply to the next
 * reply rather than after a restart.
 */
export async function loadRules(client: PoolClient): Promise<Rules> {
  const [scoring, tiers, settings] = await Promise.all([
    client.query(`SELECT code, question, choice, points FROM scoring_rules`),
    client.query(`SELECT name, min_score, max_score FROM tiers ORDER BY sort_order`),
    client.query(`SELECT value FROM settings WHERE key = 'max_invalid_before_review'`),
  ]);

  const limit = Number(settings.rows[0]?.value);

  return {
    scoring: scoring.rows.map((r) => ({
      code: r.code,
      question: r.question,
      choice: r.choice,
      points: r.points,
    })),
    tiers: tiers.rows.map((r) => ({
      name: r.name,
      minScore: r.min_score,
      maxScore: r.max_score,
    })),
    maxInvalidBeforeReview: Number.isFinite(limit) ? limit : 1,
  };
}

async function saveConversation(client: PoolClient, id: number, c: Conversation): Promise<void> {
  // expires_at is not touched here. It is the window the lead has to reply to a
  // message, so it moves only once that message has actually gone out - see
  // bumpExpiry, called after the send succeeds.
  //
  // completed_at is stamped the first time the conversation is saved as
  // completed, and kept after - migration 004, for Admin > Overview's
  // "Answered all 3".
  await client.query(
    `UPDATE conversations
     SET status = $2, step = $3, q1 = $4, q2 = $5, q3 = $6,
         invalid_count = $7, score = $8, tier = $9, updated_at = now(),
         completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END
     WHERE id = $1`,
    [id, c.status, c.step, c.q1, c.q2, c.q3, c.invalidCount, c.score, c.tier]
  );
}

export interface PendingReply {
  /** What the state machine decided. Available before the send happens. */
  result: StepResult;
  /**
   * Sends whatever `result.send` names, and records it. Call after committing:
   * see applyReply.
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
 * Returns null when the lead has no conversation at all, which the caller
 * treats as nothing to advance.
 */
export async function applyReply(
  client: PoolClient,
  leadId: number,
  phone: string,
  firstName: string | null,
  reply: { text: string; optOut: boolean }
): Promise<PendingReply | null> {
  const conversation = await loadNewestConversation(client, leadId);
  if (!conversation) return null;

  const rules = await loadRules(client);
  const result = step(conversation, reply, rules);

  await saveConversation(client, conversation.id, result.conversation);

  // The send is handed back as a closure so the caller can commit first.
  return {
    result,
    send: async () =>
      result.send ? sendFlowMessage(leadId, conversation.id, phone, firstName, result.send) : null,
  };
}

/**
 * Restarts the lead's reply window, after a message has actually gone out.
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
     SET expires_at = now() + ($2 || ' days')::interval, updated_at = now()
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
 * A failure also leaves `expires_at` where it was, so a lead who was never
 * actually messaged expires on schedule rather than a week late.
 */
async function sendFlowMessage(
  leadId: number,
  conversationId: number,
  phone: string,
  firstName: string | null,
  key: MessageKey
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { pool } = require('../db/pool') as typeof import('../db/pool');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ezt = require('../integrations/ezt-client') as typeof import('../integrations/ezt-client');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sendAndRecord } = require('../db/outbound') as typeof import('../db/outbound');

  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = $1`, [key]);
    const template: string | undefined = rows[0]?.value;
    if (!template) {
      log.error('sms.no_template', { leadId, key });
      return null;
    }

    const { text, nameDropped } = renderMessage(template, firstName);
    if (nameDropped) {
      log.info('sms.name_dropped', { leadId, key });
    }

    // Recorded around the send so it is never sent twice nor marked refused
    // after it went out - db/outbound.ts.
    const result = await sendAndRecord(pool, {
      leadId,
      body: text,
      send: () => ezt.sendMessage([phone], text),
    });
    if (!result.sent) {
      log.error('sms.failed', { leadId, key, blocked: result.blocked, err: errText(result.err) });
      return null;
    }

    await bumpExpiry(pool, conversationId);

    log.info('sms.sent', { leadId, key, eztMessageId: result.eztMessageId });
    return result.eztMessageId;
  } catch (err) {
    // Before the send: the template, or the database refusing the row. Nothing
    // went out.
    log.error('sms.failed', { leadId, key, err: errText(err) });
    return null;
  }
}
