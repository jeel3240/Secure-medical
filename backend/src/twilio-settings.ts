/**
 * Browser calling's settings, read from the environment - Phase 4, TWILIO.md.
 *
 * Calling is optional: with none of these set the app runs exactly as before
 * and the Call button explains that calling is not set up. It is on only when
 * every one is set. A partial set is the dangerous case - it looks configured
 * but every call fails - so it is reported by name rather than quietly treated
 * as "off"; production refuses to start on it (api/startup-checks.ts).
 *
 * Pure, and kept apart from src/config.ts, so it is tested without the process
 * exiting over some unrelated missing variable.
 */

export interface TwilioSettings {
  accountSid: string;
  /** Checks that requests to our voice webhooks really come from Twilio. */
  authToken: string;
  /** API key and secret: sign the short-lived token a browser calls with. */
  apiKey: string;
  apiSecret: string;
  /** The TwiML App whose Voice URL is our /api/webhooks/twilio/voice. */
  twimlAppSid: string;
  /** The number leads see, E.164. */
  callerId: string;
  /**
   * The app's public https address, no trailing slash. Twilio signs each
   * webhook against the exact URL it requested, so the URL is rebuilt from
   * this rather than from request headers a proxy may have rewritten.
   */
  publicUrl: string;
  /**
   * The transcription service, GA... Optional, and apart from the seven:
   * without it calls work exactly as before and are neither recorded nor
   * transcribed. With it, every call is recorded and transcribed - TWILIO.md,
   * "Recordings and transcripts". `npm run twilio:configure -- --transcription`
   * creates one.
   */
  transcriptionServiceSid?: string | null;
}

/** The seven that switch calling on - all or none. */
type RequiredKey = Exclude<keyof TwilioSettings, 'transcriptionServiceSid'>;

export const TRANSCRIPTION_VARIABLE = 'TWILIO_TRANSCRIPTION_SERVICE_SID';
const TRANSCRIPTION_SHAPE = /^GA[0-9a-f]{32}$/;

const VARIABLES = {
  accountSid: 'TWILIO_ACCOUNT_SID',
  authToken: 'TWILIO_AUTH_TOKEN',
  apiKey: 'TWILIO_API_KEY',
  apiSecret: 'TWILIO_API_SECRET',
  twimlAppSid: 'TWILIO_TWIML_APP_SID',
  callerId: 'TWILIO_PHONE_NUMBER',
  publicUrl: 'PUBLIC_URL',
} as const satisfies Record<RequiredKey, string>;

export type TwilioSettingsResult =
  | { status: 'off' }
  | { status: 'on'; settings: TwilioSettings }
  /** Some set, some not. `missing` names the unset or malformed variables. */
  | { status: 'incomplete'; missing: readonly string[] };

/** What each value must look like. A typo here is a call that fails later, with a worse error. */
const SHAPES: Record<RequiredKey, RegExp> = {
  accountSid: /^AC[0-9a-f]{32}$/,
  authToken: /^[0-9a-f]{32}$/,
  apiKey: /^SK[0-9a-f]{32}$/,
  apiSecret: /^[A-Za-z0-9]{32}$/,
  twimlAppSid: /^AP[0-9a-f]{32}$/,
  callerId: /^\+[1-9]\d{7,14}$/,
  publicUrl: /^https:\/\/[^\s/]+(\/[^\s]*)?$/,
};

export function readTwilioSettings(env: Record<string, string | undefined>): TwilioSettingsResult {
  const keys = Object.keys(VARIABLES) as RequiredKey[];
  const values = Object.fromEntries(
    keys.map((key) => [key, (env[VARIABLES[key]] ?? '').trim()])
  ) as Record<RequiredKey, string>;

  // PUBLIC_URL alone is not a Twilio setting; it does not switch calling on.
  const twilioKeys = keys.filter((key) => key !== 'publicUrl');
  if (twilioKeys.every((key) => values[key] === '')) return { status: 'off' };

  const missing: string[] = keys.filter((key) => !SHAPES[key].test(values[key])).map((key) => VARIABLES[key]);
  // Optional, but a typo is still a failure later, with a worse error.
  const transcription = (env[TRANSCRIPTION_VARIABLE] ?? '').trim();
  if (transcription !== '' && !TRANSCRIPTION_SHAPE.test(transcription)) missing.push(TRANSCRIPTION_VARIABLE);
  if (missing.length > 0) return { status: 'incomplete', missing };

  return {
    status: 'on',
    settings: {
      ...values,
      publicUrl: values.publicUrl.replace(/\/+$/, ''),
      transcriptionServiceSid: transcription || null,
    },
  };
}
