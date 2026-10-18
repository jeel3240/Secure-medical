/**
 * Asking Twilio to place a call from the server - T12, docs/AUTO-CALLS.md.
 *
 * The only file that rings a phone through Twilio's REST API;
 * `integrations/twilio.ts` stays a set of pure functions.
 *
 * **Asked once, never again.** The library's own retry is off, and a request
 * Twilio has not answered within ten seconds is given up, not repeated: Twilio
 * may have placed the call, and a second request could ring the lead twice.
 * Whether it did is learnt from the webhooks, which name our row.
 */

import twilio from 'twilio';
import type { CallListInstanceCreateOptions } from 'twilio/lib/rest/api/v2010/account/call';
import type { TwilioSettings } from '../twilio-settings';
import { AUTO_AMD_PATH, AUTO_ANSWER_PATH, AUTO_STATUS_PATH, autoCallUrl } from './twilio';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How long the lead's phone rings before Twilio gives up - Twilio's own
 * default, kept long so the lead's voicemail has time to answer (T18).
 */
export const LEAD_RING_SECONDS = 60;

export type PlaceResult =
  | { kind: 'placed'; callSid: string }
  /** Twilio said no - a bad number, a number we may not call: nothing rang. */
  | { kind: 'refused'; status: number; code: number | null }
  /** No answer from Twilio, or a fault on its side: it may or may not have placed the call. */
  | { kind: 'unknown'; error: string };

/**
 * What Twilio is asked for. Pure, so what a call is placed with is tested
 * without placing one.
 *
 * - Twilio fetches what to say from `/auto/answer` once the lead picks up,
 *   and reports how the call ended to `/auto/status`.
 * - Voicemail detection runs beside the call, not in front of it (`asyncAmd`):
 *   the lead hears the question at once, and the verdict - person or machine,
 *   after the machine's greeting ends (`DetectMessageEnd`) - arrives at
 *   `/auto/amd`. T18 acts on it.
 */
export function automatedCallRequest(
  settings: TwilioSettings,
  opts: { to: string; callId: number }
): CallListInstanceCreateOptions {
  return {
    to: opts.to,
    from: settings.callerId,
    url: autoCallUrl(settings, AUTO_ANSWER_PATH, opts.callId),
    method: 'POST',
    statusCallback: autoCallUrl(settings, AUTO_STATUS_PATH, opts.callId),
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['completed'],
    timeout: LEAD_RING_SECONDS,
    machineDetection: 'DetectMessageEnd',
    asyncAmd: 'true',
    asyncAmdStatusCallback: autoCallUrl(settings, AUTO_AMD_PATH, opts.callId),
    asyncAmdStatusCallbackMethod: 'POST',
  };
}

/**
 * Asks Twilio to ring `to` for our call row `callId`. Never throws.
 *
 * A refusal keeps only Twilio's status and error code: its message can quote
 * the number, and numbers are never logged (LOGGING.md).
 */
export async function placeAutomatedCall(
  settings: TwilioSettings,
  opts: { to: string; callId: number }
): Promise<PlaceResult> {
  try {
    const client = twilio(settings.accountSid, settings.authToken, { timeout: REQUEST_TIMEOUT_MS, autoRetry: false });
    const call = await client.calls.create(automatedCallRequest(settings, opts));
    return { kind: 'placed', callSid: call.sid };
  } catch (err) {
    const { status, code } = err as { status?: unknown; code?: unknown };
    // A 4xx is Twilio refusing the request: nothing was placed. A 5xx, a
    // timeout or a dropped connection says nothing either way.
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return { kind: 'refused', status, code: typeof code === 'number' ? code : null };
    }
    return { kind: 'unknown', error: typeof code === 'string' ? code : typeof status === 'number' ? `http_${status}` : 'no_response' };
  }
}
