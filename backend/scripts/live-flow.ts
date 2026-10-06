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

/** One reply from the lead, through the path the webhook takes. Returns what the flow decided. */
export async function replyAs(leadId: number, text: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pending = await applyReply(client, leadId, '+15550000000', 'Test', { text, optOut: false });
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
