/**
 * Twilio, for browser calling - Phase 4, TWILIO.md.
 *
 * The only file that touches the twilio library. Everything here is a pure
 * function of the settings and its arguments: it makes no network call, so the
 * routes that use it are tested without Twilio.
 */

import twilio from 'twilio';
import { identityFor } from '../core/calls';
import type { TwilioSettings } from '../twilio-settings';

/** An hour: long enough for a shift's calls, refreshed by the browser before it lapses. */
export const TOKEN_TTL_SECONDS = 60 * 60;

export const VOICE_PATH = '/api/webhooks/twilio/voice';
export const STATUS_PATH = '/api/webhooks/twilio/status';

/**
 * The browser's permission to place calls through our TwiML App, as one agent.
 * Outgoing only: no grant to receive calls, because nothing in the app answers
 * them.
 */
export function mintCallToken(settings: TwilioSettings, userId: number): { token: string; identity: string } {
  const identity = identityFor(userId);
  const token = new twilio.jwt.AccessToken(settings.accountSid, settings.apiKey, settings.apiSecret, {
    identity,
    ttl: TOKEN_TTL_SECONDS,
  });
  token.addGrant(
    new twilio.jwt.AccessToken.VoiceGrant({
      outgoingApplicationSid: settings.twimlAppSid,
      incomingAllow: false,
    })
  );
  return { token: token.toJwt(), identity };
}

/**
 * Whether a webhook request really came from Twilio: its X-Twilio-Signature is
 * an HMAC of the exact URL Twilio requested plus the posted fields, keyed with
 * our auth token. The URL is rebuilt from PUBLIC_URL, not from the request,
 * because a proxy in front of the API changes the scheme and may change the
 * host Express sees.
 */
export function isFromTwilio(
  settings: TwilioSettings,
  opts: { signature: string | undefined; path: string; params: Record<string, unknown> }
): boolean {
  if (!opts.signature) return false;
  return twilio.validateRequest(settings.authToken, opts.signature, settings.publicUrl + opts.path, opts.params);
}

/**
 * Connect the agent's browser to the lead's phone, showing our number.
 *
 * `answerOnBridge` keeps the browser's side ringing until the lead answers, so
 * the agent hears real ringback and the screen's "Ringing" is true, rather than
 * the browser leg showing connected while the phone is still ringing.
 * The status callback on the lead's leg reports how the call ended, however it
 * ends - either side hanging up, no answer, busy, a bad number.
 */
export function dialTwiml(settings: TwilioSettings, phone: string): string {
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({ callerId: settings.callerId, answerOnBridge: true });
  dial.number(
    {
      statusCallback: settings.publicUrl + STATUS_PATH,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['completed'],
    },
    phone
  );
  return response.toString();
}

/** Tell the agent why, then end the call. */
export function refusalTwiml(speech: string): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(speech);
  response.hangup();
  return response.toString();
}
