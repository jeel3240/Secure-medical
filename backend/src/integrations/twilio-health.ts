/**
 * Is calling still wired up - the `calling` check on the deep health report,
 * LOGGING.md.
 *
 * Calling fails silently in one particular way. Twilio asks two addresses how
 * to handle a call: the TwiML App's Voice URL for a call a browser places, and
 * the phone number's Voice URL for a lead calling in. Both must be this
 * server. If either points somewhere else - a developer ran `twilio:configure`
 * against the same number from their laptop, or `PUBLIC_URL` changed and
 * nobody re-ran it - calls simply stop arriving here. Nothing crashes and
 * nothing is logged, because the request never reaches us. So this asks
 * Twilio where they point and compares.
 *
 * The verdict is a pure function; the fetch is kept apart and cached, since the
 * Overview page polls health every five seconds and Twilio's settings change
 * about never.
 */

import twilio from 'twilio';
import type { HealthCheck } from '../db/health';
import type { TwilioSettings } from '../twilio-settings';
import { INCOMING_PATH, VOICE_PATH } from './twilio';

/** What Twilio says, or that it could not be asked. */
export type CallingSetup =
  | {
      reached: true;
      /** The TwiML App's Voice URL. */
      appVoiceUrl: string | null;
      /** The phone number's Voice URL; `numberFound` false when the number is not on the account. */
      numberFound: boolean;
      numberVoiceUrl: string | null;
      /** A TwiML App set on the number overrides its Voice URL. */
      numberApplicationSid: string | null;
    }
  | { reached: false; error: string };

const fix = 'Run `npm run twilio:configure` on this server.';

/** The `calling` check, from the settings and what Twilio reported. Pure. */
export function callingCheck(settings: TwilioSettings | null, setup: CallingSetup | null): HealthCheck {
  // Not set up is a choice, not a fault: no verdict, like Incoming replies.
  if (!settings || !setup) {
    return { name: 'calling', status: 'info', message: null, detail: { enabled: false } };
  }

  const detail: Record<string, unknown> = { enabled: true, phoneNumber: settings.callerId };
  const degraded = (message: string): HealthCheck => ({ name: 'calling', status: 'degraded', message, detail });

  if (!setup.reached) {
    return degraded('Twilio could not be reached to check the calling setup.');
  }

  const wantOutgoing = settings.publicUrl + VOICE_PATH;
  const wantIncoming = settings.publicUrl + INCOMING_PATH;
  Object.assign(detail, { appVoiceUrl: setup.appVoiceUrl, numberVoiceUrl: setup.numberVoiceUrl });

  if (!setup.numberFound) {
    return degraded(`${settings.callerId} is not a number on the Twilio account.`);
  }
  // Incoming first: it is the one another deployment silently takes.
  if (setup.numberApplicationSid || setup.numberVoiceUrl !== wantIncoming) {
    return degraded(`Incoming calls are not reaching this server: the phone number points somewhere else. ${fix}`);
  }
  if (setup.appVoiceUrl !== wantOutgoing) {
    return degraded(`Calls agents place will fail: the TwiML App points somewhere else. ${fix}`);
  }
  return { name: 'calling', status: 'ok', message: null, detail };
}

/** Asks Twilio where the TwiML App and the phone number point. Never throws. */
export async function fetchCallingSetup(settings: TwilioSettings): Promise<CallingSetup> {
  try {
    const client = twilio(settings.accountSid, settings.authToken);
    const [app, numbers] = await Promise.all([
      client.applications(settings.twimlAppSid).fetch(),
      client.incomingPhoneNumbers.list({ phoneNumber: settings.callerId, limit: 1 }),
    ]);
    const number = numbers[0];
    return {
      reached: true,
      appVoiceUrl: app.voiceUrl || null,
      numberFound: Boolean(number),
      numberVoiceUrl: number?.voiceUrl || null,
      numberApplicationSid: number?.voiceApplicationSid || null,
    };
  } catch (err) {
    return { reached: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A minute: the page asks every five seconds, and Twilio is asked once in twelve. */
const CACHE_MS = 60_000;
let cached: { at: number; setup: CallingSetup } | null = null;

/** The `calling` check, asking Twilio at most once a minute. */
export async function getCallingCheck(settings: TwilioSettings | null, now = Date.now()): Promise<HealthCheck> {
  if (!settings) return callingCheck(null, null);
  if (!cached || now - cached.at >= CACHE_MS) {
    cached = { at: now, setup: await fetchCallingSetup(settings) };
  }
  return callingCheck(settings, cached.setup);
}
