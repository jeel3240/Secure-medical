/**
 * Asking Twilio to place a call from the server - T12, docs/AUTO-CALLS.md -
 * and, once a transfer's ringing is over, how each person's ring of it ended
 * (T15c); cutting a lead's hold music short - to end the hold (T16), or to
 * ring the person who came free (T17); and handing a call a machine answered
 * to the voicemail message (T18).
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
import { AUTO_AMD_PATH, AUTO_ANSWER_PATH, AUTO_HOLD_PATH, AUTO_OFFER_PATH, AUTO_STATUS_PATH, autoCallUrl } from './twilio';

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

/** One ring of a transfer, as Twilio keeps it - `transferRings`. */
export interface TransferRing {
  /** Who was rung: `client:agent-16`. */
  to: string;
  /** `no-answer` (ran out, or cut short), `busy` (declined), `completed` (taken). */
  status: string;
  startedAt: Date | null;
}

/**
 * How each ring of the automated call `callSid`'s transfer ended - its rings
 * are the call's child calls. Read once the ringing is over (T15c). Null when
 * Twilio could not be asked: then nobody's switch is changed.
 */
export async function transferRings(settings: TwilioSettings, callSid: string): Promise<TransferRing[] | null> {
  try {
    const client = twilio(settings.accountSid, settings.authToken, { timeout: REQUEST_TIMEOUT_MS });
    const legs = await client.calls.list({ parentCallSid: callSid, limit: 50 });
    return legs.map((leg) => ({ to: leg.to, status: leg.status, startedAt: leg.startTime ?? null }));
  } catch {
    return null;
  }
}

/**
 * Sends the automated call `callSid`, waiting on hold, back to `/auto/hold`
 * for `callId` now, cutting its music short - T16: the hold watcher found it
 * should not wait any more. Marked `via=watcher`: Twilio was seen asking
 * `/auto/hold` a second time as the music was cut, the two requests otherwise
 * alike. True when Twilio took it. Never throws.
 */
export async function recheckHold(settings: TwilioSettings, callSid: string, callId: number): Promise<boolean> {
  try {
    const client = twilio(settings.accountSid, settings.authToken, { timeout: REQUEST_TIMEOUT_MS });
    await client.calls(callSid).update({ url: autoCallUrl(settings, AUTO_HOLD_PATH, callId, { via: 'watcher' }), method: 'POST' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends the automated call `callSid`, waiting on hold, to ring the person its
 * offer `offerId` names - now, cutting the hold music short (T17). Twilio
 * follows this redirect, not the music page's own request that comes with it
 * (tested on a real call, 2026-10-22, call 46). True when Twilio took it. Never throws.
 */
export async function sendToOffer(settings: TwilioSettings, callSid: string, callId: number, offerId: number): Promise<boolean> {
  try {
    const client = twilio(settings.accountSid, settings.authToken, { timeout: REQUEST_TIMEOUT_MS });
    await client.calls(callSid).update({ url: autoCallUrl(settings, AUTO_OFFER_PATH, callId, { offer: offerId }), method: 'POST' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Replaces what the live call `callSid` is doing with `twiml`, now - T18: the
 * voicemail message after the beep, or a fax hung up on. Whatever it was
 * doing stops - a question, a transfer ringing, the hold music. True when
 * Twilio took it; false when it refused - most often, the call already over.
 * Never throws.
 */
export async function replaceCall(settings: TwilioSettings, callSid: string, twiml: string): Promise<boolean> {
  try {
    const client = twilio(settings.accountSid, settings.authToken, { timeout: REQUEST_TIMEOUT_MS });
    await client.calls(callSid).update({ twiml });
    return true;
  } catch {
    return false;
  }
}
