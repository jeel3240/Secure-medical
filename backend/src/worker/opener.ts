/**
 * Sends question 1 to one lead: the poller's first attempt and the retry's
 * later ones. Until 2026-09-28 each carried its own copy of these steps.
 *
 * Renders the stored copy, sends it and records it around the send
 * (`db/outbound.ts`), and - only once it has gone out - starts the reply
 * window. Logging stays with the caller, which knows whether this was a first
 * attempt or a retry.
 *
 * Throws when the database fails before the send (nothing went out) or after
 * it (the text went out and its row says so); the caller logs and moves on.
 */

import { sendAndRecord, type SendResult } from '../db/outbound';
import { pool } from '../db/pool';
import { readExpiryDays } from '../db/sql';
import { renderMessage } from '../core/messages';
import { sendMessage } from '../integrations/ezt-client';
import { log } from '../lib/log';

export async function sendOpener(
  lead: { id: number; phone: string; firstName: string | null },
  template: string
): Promise<SendResult> {
  // The stored copy carries {first_name}; what goes out, and what is recorded
  // in messages.body, is the rendered text.
  const { text, nameDropped } = renderMessage(template, lead.firstName);
  if (nameDropped) {
    log.info('sms.name_dropped', { leadId: lead.id, key: 'question_1' });
  }

  const result = await sendAndRecord(pool, {
    leadId: lead.id,
    body: text,
    send: () => sendMessage([lead.phone], text),
  });

  if (result.sent) {
    // The reply window starts when the opener actually goes out, not when the
    // lead arrived: a conversation whose opener failed has no deadline it
    // never earned (the expiry sweep falls back to created_at for those), and
    // a retried lead gets its full seven days from when it was asked. This is
    // also what marks the opener as sent for the retry - an open conversation
    // with no expires_at never had one go out. `question_sent_at` says the same
    // to the reply flow: from now a reply can be an answer to it.
    const days = await readExpiryDays(pool);
    await pool.query(
      `UPDATE conversations
       SET expires_at = now() + ($2 || ' days')::interval, question_sent_at = now(), updated_at = now()
       WHERE lead_id = $1 AND status = 'open'`,
      [lead.id, String(days)]
    );
  }

  return result;
}
