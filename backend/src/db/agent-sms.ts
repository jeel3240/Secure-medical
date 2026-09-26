/**
 * An agent sending a manual SMS to a lead - and the handoff it causes.
 *
 * Sending one stops the automated questions for good: STATE-MACHINE.md rule 2b,
 * Jeel's decision of 2026-09-23. The lead is now talking to a person, and an
 * automated "Question 2 of 3" landing on top of that conversation reads as a
 * broken system to someone we are trying to sell to.
 *
 * AGENT-WORKSPACE.md, "Agent SMS".
 */

import { pool } from './pool';
import { SEGMENT_LIMIT } from '../core/messages';

export interface AgentMessage {
  id: number;
  leadId: number;
  body: string;
  sentBy: number;
  agentName: string | null;
  eztMessageId: string | null;
  createdAt: string;
  /** True when this send is what stopped the automated questions. */
  tookOver: boolean;
}

export type SendAgentSmsResult =
  | { ok: true; message: AgentMessage }
  | { ok: false; reason: 'lead_not_found' }
  | { ok: false; reason: 'blocked'; phone: string }
  | { ok: false; reason: 'send_failed'; detail: string };

/** Longer than one segment costs a second one on every send. The screen counts down to this. */
export const AGENT_SMS_LIMIT = SEGMENT_LIMIT;

/**
 * Sends the text, records it, and marks the conversation taken over.
 *
 * **The send happens before the database write,** which is the opposite of the
 * usual order and deliberate. If we wrote first and the send failed, the lead
 * would show a message in their timeline that never arrived, and rule 2b would
 * have silenced the automated flow on the strength of a message nobody
 * received. Sending first means the worst case is a delivered text we failed to
 * record - visible in EZ Texting, recoverable - rather than a silent lie in the
 * timeline.
 *
 * **A blocked number is refused by `sendMessage` itself,** which checks
 * `dnc_list` immediately before every send. Nothing is written when it throws,
 * so an agent texting a lead who opted out a second earlier changes nothing.
 *
 * **The take-over timestamp is only set once.** `COALESCE` keeps the first
 * send's time: the handoff happened then, and the tenth message should not
 * rewrite when the agent took the conversation.
 */
export async function sendAgentSms(
  leadId: number,
  agentId: number,
  body: string
): Promise<SendAgentSmsResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ezt = require('../integrations/ezt-client') as typeof import('../integrations/ezt-client');

  const lead = await pool.query('SELECT id, phone FROM leads WHERE id = $1', [leadId]);
  if (!lead.rowCount) return { ok: false, reason: 'lead_not_found' };

  const phone: string = lead.rows[0].phone;

  let eztMessageId: string | null = null;
  try {
    const sent = await ezt.sendMessage([phone], body);
    eztMessageId = sent.id ?? null;
  } catch (err) {
    if (err instanceof ezt.BlockedNumberError) {
      return { ok: false, reason: 'blocked', phone };
    }
    const detail =
      (err as { response?: { data?: unknown } })?.response?.data ??
      (err instanceof Error ? err.message : String(err));
    console.error(`agent sms to lead ${leadId} failed:`, JSON.stringify(detail));
    return { ok: false, reason: 'send_failed', detail: typeof detail === 'string' ? detail : 'send failed' };
  }

  // It is out. Record it and mark the handoff in one transaction, so the
  // timeline entry and the reason the questions stopped cannot disagree.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO messages (lead_id, direction, body, ezt_message_id, sent_by)
       VALUES ($1, 'outbound', $2, $3, $4)
       RETURNING id, created_at`,
      [leadId, body, eztMessageId, agentId]
    );

    // Only the newest conversation, and only while it is open: a completed or
    // suppressed one is finished, and an agent texting afterwards is not taking
    // over a flow that is still running.
    const took = await client.query(
      `UPDATE conversations
       SET agent_took_over_at = COALESCE(agent_took_over_at, now())
       WHERE id = (
         SELECT id FROM conversations
         WHERE lead_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )
       AND status = 'open'
       AND agent_took_over_at IS NULL
       RETURNING id`,
      [leadId]
    );

    const who = await client.query('SELECT name FROM users WHERE id = $1', [agentId]);

    await client.query('COMMIT');

    return {
      ok: true,
      message: {
        id: rows[0].id,
        leadId,
        body,
        sentBy: agentId,
        agentName: who.rows[0]?.name ?? null,
        eztMessageId,
        createdAt: rows[0].created_at.toISOString(),
        tookOver: (took.rowCount ?? 0) > 0,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
