/**
 * Places one automated call - T12, docs/AUTO-CALLS.md. The one way the server
 * places a call: the dev command uses it (`scripts/dev-auto-call.ts`), and so
 * does the robot's dialler (T20, `worker/auto-calls.ts`).
 *
 * 1. **The row first** (`startAutomatedCall`): the lead locked; the number
 *    checked against the do-not-call list and, outside production, the test
 *    numbers; one automated call per lead; `call.started` - in one
 *    transaction. A refusal stops here, and nothing rings.
 * 2. **Then Twilio, once** (`placeAutomatedCall`).
 * 3. **Its answer.** Placed: Twilio's id is kept on the row. Refused: the row
 *    is ended as failed. No answer: the row is left as it is - the call may
 *    have gone out, and if it did, its first webhook fills in the id.
 */

import { mayRing, type AutoCallNumbers } from '../auto-calls-settings';
import {
  failAutomatedCall,
  linkAutomatedCall,
  startAutomatedCall,
  type AutoCallRefusal,
} from '../db/auto-calls';
import { placeAutomatedCall } from '../integrations/twilio-calls';
import { errText, log } from '../lib/log';
import type { TwilioSettings } from '../twilio-settings';

export type PlaceAutoCallResult =
  | { kind: 'placed'; callId: number }
  | { kind: 'refused'; reason: AutoCallRefusal }
  /** Twilio refused it: the row is ended as failed. */
  | { kind: 'failed'; callId: number }
  /** Twilio did not answer: the call may have gone out. */
  | { kind: 'unconfirmed'; callId: number };

export async function placeAutoCall(opts: {
  leadId: number;
  settings: TwilioSettings;
  numbers: AutoCallNumbers;
}): Promise<PlaceAutoCallResult> {
  const { leadId } = opts;
  const started = await startAutomatedCall({ leadId, mayRing: (phone) => mayRing(opts.numbers, phone) });
  if (!started.ok) {
    log.warn('auto_call.refused', { leadId, reason: started.reason });
    return { kind: 'refused', reason: started.reason };
  }
  const { callId } = started;

  const placed = await placeAutomatedCall(opts.settings, { to: started.phone, callId });
  switch (placed.kind) {
    case 'placed':
      try {
        await linkAutomatedCall(callId, placed.callSid);
      } catch (err) {
        // The phone is ringing; the call's first webhook links it instead.
        log.error('auto_call.link_failed', { leadId, callId, callSid: placed.callSid, err: errText(err) });
      }
      log.info('auto_call.placed', { leadId, callId, callSid: placed.callSid });
      return { kind: 'placed', callId };

    case 'refused':
      await failAutomatedCall(callId, { status: placed.status, code: placed.code });
      log.error('auto_call.failed', { leadId, callId, twilioStatus: placed.status, twilioCode: placed.code });
      return { kind: 'failed', callId };

    case 'unknown':
      log.warn('auto_call.unconfirmed', { leadId, callId, error: placed.error });
      return { kind: 'unconfirmed', callId };
  }
}
