/**
 * The automated texts a lead gets because of a call - each sent and recorded
 * like every automated text (`db/outbound.ts`), so it is on the lead's thread
 * and cannot go out twice. A number on the do-not-call list gets nothing -
 * `sendMessage` refuses it, as it does every other text - and that is not an
 * error: they asked not to be texted.
 *
 * - **The text after a missed call** - Jeel, 2026-10-01; TWILIO.md, "Incoming
 *   calls". "Our team member is not available right now and will call you
 *   back." They heard the same on the phone; the text is what is still there
 *   an hour later. Its words are `settings.message_missed_call`.
 * - **The link** - T14, AUTO-CALLS.md: a lead who said yes to it on the
 *   automated call. Its words are the active call script's `link_text`, the
 *   link the SMS flow already sends.
 *
 * Never throw. The call has already been recorded; a text that could not be
 * sent must not turn Twilio's request into a failure it retries.
 */

import { renderMessage } from '../core/messages';
import { errText, log } from '../lib/log';
import { sendAndRecord } from './outbound';
import { pool } from './pool';

/**
 * Sends `template` to the lead - `{first_name}` filled in, as every automated
 * text - and records it. `key` names the text in the logs. True when sent.
 */
async function sendLeadText(leadId: number, key: string, template: string | null): Promise<boolean> {
  try {
    if (!template) {
      log.error('sms.no_template', { leadId, key });
      return false;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ezt = require('../integrations/ezt-client') as typeof import('../integrations/ezt-client');

    const { rows } = await pool.query<{ phone: string; first_name: string | null }>(
      `SELECT phone, first_name FROM leads WHERE id = $1`,
      [leadId]
    );
    const lead = rows[0];
    if (!lead) return false;

    const { text } = renderMessage(template, lead.first_name);
    const result = await sendAndRecord(pool, { leadId, body: text, send: () => ezt.sendMessage([lead.phone], text) });
    if (!result.sent) {
      log.warn('sms.failed', { leadId, key, blocked: result.blocked, err: errText(result.err) });
      return false;
    }
    log.info('sms.sent', { leadId, key, eztMessageId: result.eztMessageId });
    return true;
  } catch (err) {
    log.error('sms.failed', { leadId, key, err: errText(err) });
    return false;
  }
}

/** The text after a missed call. */
export async function sendMissedCallText(leadId: number): Promise<boolean> {
  return sendWords(leadId, 'message_missed_call', `SELECT value AS words FROM settings WHERE key = 'message_missed_call'`);
}

/** The link a lead said yes to on the automated call - the active script's `link_text`. */
export async function sendCallLinkText(leadId: number): Promise<boolean> {
  return sendWords(leadId, 'call_link_text', `SELECT link_text AS words FROM call_scripts WHERE is_active`);
}

/** Reads a text's words with `sql`, then sends them. Missing words are `sms.no_template`. */
async function sendWords(leadId: number, key: string, sql: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ words: string }>(sql);
    return sendLeadText(leadId, key, rows[0]?.words ?? null);
  } catch (err) {
    log.error('sms.failed', { leadId, key, err: errText(err) });
    return false;
  }
}
