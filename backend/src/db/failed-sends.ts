/**
 * Keeps a message EZ Texting refused, so the thread can show it - Jeel,
 * 2026-09-28: a red "!" beside it, as in WhatsApp.
 *
 * Until then a refused send was only a line in the server log. An agent never
 * saw that question 2 had not gone out, or that the opener never reached a new
 * lead; the conversation just looked quiet.
 *
 * The row is `direction = 'outbound'`, `delivery_status = 'failed'`, and has no
 * `ezt_message_id` - nothing was accepted, so there is nothing for a reply to
 * point back at. Everything that means "a message went out" leaves these rows
 * out: the Overview activity feed and Admin > Leads' Last activity. A blocked
 * number is not recorded at all: that send was never attempted.
 *
 * Used for an agent's own SMS, which sends first and then writes. The three
 * automated paths write their row before sending instead, and mark it failed
 * there - `db/outbound.ts`, since 2026-09-28.
 *
 * Never throws. It runs in the catch of a send that has already failed, and a
 * second failure there must not replace the first in the log or break the
 * caller.
 */

import { activityInsertSql } from './activity';
import { pool } from './pool';
import { errText, log } from '../lib/log';

export async function recordFailedSend(
  leadId: number,
  body: string,
  sentBy: number | null = null
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, sent_by, delivery_status)
       VALUES ($1, 'outbound', $2, $3, 'failed')`,
      [leadId, body, sentBy]
    );
  } catch (err) {
    log.error('sms.record_failed', { leadId, err: errText(err) });
  }
}

/**
 * An agent's own text EZ Texting refused: the failed message and its
 * `sms.failed` record in one statement, so neither is kept without the other -
 * two writes, the record could stand with no message, or the request fail
 * after the message was kept (review M12, 2026-11-22). Never throws: a failure
 * here is logged, and the agent is told the text did not go, as it did not.
 */
export async function recordAgentFailedSend(leadId: number, body: string, agentId: number): Promise<void> {
  try {
    await pool.query(
      `WITH kept AS (
         INSERT INTO messages (lead_id, direction, body, sent_by, delivery_status)
         VALUES ($1, 'outbound', $2, $3, 'failed')
         RETURNING lead_id
       )
       ${activityInsertSql}
       SELECT $3, 'sms.failed', lead_id, NULL, '{}'::jsonb FROM kept`,
      [leadId, body, agentId]
    );
  } catch (err) {
    log.error('sms.record_failed', { leadId, err: errText(err) });
  }
}
