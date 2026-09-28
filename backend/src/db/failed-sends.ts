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
 * Never throws. It runs in the catch of a send that has already failed, and a
 * second failure there must not replace the first in the log or break the
 * caller - the poller would abandon its page.
 */

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
 * Whether a send was refused because the number is blocked - checked by name
 * rather than `instanceof`, so it holds wherever the EZ Texting client is
 * replaced, as the tests do.
 */
export function isBlocked(err: unknown): boolean {
  return err instanceof Error && err.name === 'BlockedNumberError';
}
