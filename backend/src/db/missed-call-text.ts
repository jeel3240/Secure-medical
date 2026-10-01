/**
 * The text a lead gets when their call was not answered - Jeel, 2026-10-01.
 * TWILIO.md, "Incoming calls".
 *
 * "Our team member is not available right now and will call you back." They
 * heard the same on the phone; the text is what is still there an hour later.
 *
 * Sent and recorded like every automated text (`db/outbound.ts`), so it is on
 * the lead's thread and cannot go out twice. A number on the do-not-call list
 * gets nothing - `sendMessage` refuses it, as it does every other text - and
 * that is not an error: they asked not to be texted.
 *
 * Never throws. The call has already been recorded as missed; a text that
 * could not be sent must not turn Twilio's callback into a failure it retries.
 */

import { renderMessage } from '../core/messages';
import { errText, log } from '../lib/log';
import { sendAndRecord } from './outbound';
import { pool } from './pool';

const TEMPLATE_KEY = 'message_missed_call';

export async function sendMissedCallText(leadId: number): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ezt = require('../integrations/ezt-client') as typeof import('../integrations/ezt-client');

    const { rows } = await pool.query<{ phone: string; first_name: string | null; template: string | null }>(
      `SELECT l.phone, l.first_name, (SELECT value FROM settings WHERE key = $2) AS template
       FROM leads l WHERE l.id = $1`,
      [leadId, TEMPLATE_KEY]
    );
    const lead = rows[0];
    if (!lead) return false;
    if (!lead.template) {
      log.error('sms.no_template', { leadId, key: TEMPLATE_KEY });
      return false;
    }

    const { text } = renderMessage(lead.template, lead.first_name);
    const result = await sendAndRecord(pool, { leadId, body: text, send: () => ezt.sendMessage([lead.phone], text) });
    if (!result.sent) {
      log.warn('sms.failed', { leadId, key: TEMPLATE_KEY, blocked: result.blocked, err: errText(result.err) });
      return false;
    }
    log.info('sms.sent', { leadId, key: TEMPLATE_KEY, eztMessageId: result.eztMessageId });
    return true;
  } catch (err) {
    log.error('sms.failed', { leadId, key: TEMPLATE_KEY, err: errText(err) });
    return false;
  }
}
