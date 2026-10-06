/**
 * For the live checks: puts a test lead somewhere in the flow the way a real
 * one gets there - a conversation started in the active flow, and replies run
 * through the real reply path. So a check's lead has the rows a real lead
 * has: its flow, its current question, its saved answers, its score.
 *
 * Nothing is sent: `applyReply` hands the send back to its caller, and this
 * never calls it. docs/FLOWS.md.
 */
import { applyReply } from '../src/api/reply-flow';
import { startConversation } from '../src/db/flows';
import { pool } from '../src/db/pool';

/**
 * One reply from the lead, through the path the webhook takes. Returns what
 * the flow decided.
 *
 * `stored`: also keep the text as an inbound message first, as the webhook
 * does, so the answer is tied to it - for checks that read the thread.
 */
export async function replyAs(leadId: number, text: string, opts: { stored?: boolean } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let messageId: number | undefined;
    if (opts.stored) {
      const { rows } = await client.query(
        `INSERT INTO messages (lead_id, direction, body, from_number, received_at)
         SELECT l.id, 'inbound', $2, ltrim(l.phone, '+'), clock_timestamp() FROM leads l WHERE l.id = $1
         RETURNING id`,
        [leadId, text]
      );
      messageId = rows[0].id;
    }
    const pending = await applyReply(client, leadId, '+15550000000', 'Test', { text, optOut: false, messageId });
    await client.query('COMMIT');
    return pending;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Starts the lead's conversation and answers as given, in order: `['1', '1',
 * '2']` is Yes, Yes, Talk to an agent on the antibiotics flow. Returns the
 * conversation's id.
 */
export async function startFlow(leadId: number, replies: string[] = []): Promise<number> {
  await startConversation(pool, leadId, 'open');
  for (const text of replies) await replyAs(leadId, text);
  const { rows } = await pool.query(
    `SELECT id FROM conversations WHERE lead_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [leadId]
  );
  return rows[0].id;
}
