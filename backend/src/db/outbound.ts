/**
 * Sends an automated text and records it, in an order that can never send the
 * same text twice or mark a delivered one failed.
 *
 * Used by the four automated send paths - the poller's opener, the opener
 * retry, the reply flow's next question, and the text after a missed call
 * (db/missed-call-text.ts). Until 2026-09-28 each sent first,
 * wrote the message row after, and treated *any* error as a failed send. So if
 * EZ Texting accepted a text and the database write after it failed, the text
 * was recorded as refused - a red "!" on a text the lead received - and the
 * opener retry, reading that row, sent the opener again. Found in review.
 *
 * The row now comes first:
 *
 *   1. write the message as `sending`. If the database cannot take that,
 *      nothing is sent - the caller's catch sees the error.
 *   2. send. If EZ Texting refuses, the row becomes `failed` (the red "!"), or
 *      is removed for a blocked number, which was never attempted.
 *   3. record EZ Texting's id on the row. If *that* write fails the text has
 *      gone out, so the row is left as `sending`: never retried, never shown as
 *      failed. The failure is logged.
 *
 * An agent's own SMS does not use this: it sends first on purpose, and marks
 * the take-over in the same transaction - `db/agent-sms.ts`.
 */

import type { Querier } from './sql';
import { errText, log } from '../lib/log';

/**
 * Whether a send was refused because the number is blocked - checked by name
 * rather than `instanceof`, so it holds wherever the EZ Texting client is
 * replaced, as the tests do.
 */
export function isBlocked(err: unknown): boolean {
  return err instanceof Error && err.name === 'BlockedNumberError';
}

export type SendResult =
  | { sent: true; eztMessageId: string }
  | { sent: false; blocked: boolean; err: unknown };

export async function sendAndRecord(
  q: Querier,
  opts: { leadId: number; body: string; send: () => Promise<{ id: string }> }
): Promise<SendResult> {
  const { rows } = await q.query(
    `INSERT INTO messages (lead_id, direction, body, delivery_status)
     VALUES ($1, 'outbound', $2, 'sending') RETURNING id`,
    [opts.leadId, opts.body]
  );
  const rowId = rows[0]?.id as number;

  let eztMessageId: string;
  try {
    eztMessageId = (await opts.send()).id;
  } catch (err) {
    const blocked = isBlocked(err);
    try {
      await q.query(
        blocked
          ? `DELETE FROM messages WHERE id = $1`
          : `UPDATE messages SET delivery_status = 'failed' WHERE id = $1`,
        [rowId]
      );
    } catch (writeErr) {
      log.error('sms.record_failed', { leadId: opts.leadId, err: errText(writeErr) });
    }
    return { sent: false, blocked, err };
  }

  try {
    await q.query(`UPDATE messages SET ezt_message_id = $2, delivery_status = NULL WHERE id = $1`, [
      rowId,
      eztMessageId,
    ]);
  } catch (err) {
    // It went out. Leaving the row as `sending` keeps it from being retried or
    // shown as refused; only the EZ Texting id is missing.
    log.error('sms.record_failed', { leadId: opts.leadId, sentAnyway: true, err: errText(err) });
  }
  return { sent: true, eztMessageId };
}
