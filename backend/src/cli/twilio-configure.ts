/**
 * Points Twilio at this deployment - Phase 4, TWILIO.md.
 *
 * Two settings, both this server's public address:
 *
 *   - the TwiML App's Voice URL: how to connect a call a browser starts
 *   - our phone number's Voice URL: what to do when a lead calls that number
 *
 * Run it once after setting PUBLIC_URL, and again whenever PUBLIC_URL changes
 * (a new tunnel address locally):
 *
 *   docker compose exec api npm run dev:twilio:configure
 *   (production: npm run twilio:configure)
 *
 * It changes those two settings and nothing else on the account. A number
 * whose calls already go somewhere that is not this app is left alone unless
 * `--take-over` is passed. Reads only the Twilio variables, so it runs without
 * a database.
 *
 * `--transcription` also makes the transcription service that call transcripts
 * go through, if there is none yet, and prints its id for `.env`.
 *
 * **Never run this locally with production's number or TwiML App** - Jeel,
 * 2026-10-05. Local testing uses its own. The guard below does not help: a
 * laptop and production share the webhook path, so it sees "ours".
 *
 * **One number, one deployment.** The number can ring only one address. Run
 * locally against the number production uses and production stops receiving
 * calls until this is run there again.
 */
import twilio from 'twilio';
import { INCOMING_PATH, VOICE_PATH } from '../integrations/twilio';
import { readTwilioSettings } from '../twilio-settings';

async function main(): Promise<number> {
  const result = readTwilioSettings(process.env);
  if (result.status === 'off') {
    console.error('Calling is not set up: no TWILIO_* variables are set. See .env.example.');
    return 1;
  }
  if (result.status === 'incomplete') {
    console.error(`Calling is set up only partly. Missing or malformed: ${result.missing.join(', ')}.`);
    return 1;
  }

  const { accountSid, authToken, twimlAppSid, callerId, publicUrl } = result.settings;
  const client = twilio(accountSid, authToken);

  await pointTwimlApp(client, twimlAppSid, publicUrl + VOICE_PATH);
  const numberResult = await pointNumber(client, callerId, publicUrl + INCOMING_PATH, process.argv.includes('--take-over'));
  if (process.argv.includes('--transcription')) await ensureTranscriptionService(client, result.settings.transcriptionServiceSid ?? null);
  return numberResult;
}

/** One per account, found again by this name rather than made twice. */
const SERVICE_NAME = 'secure-medical-call-transcripts';

/**
 * The transcription service calls are transcribed through - TWILIO.md,
 * "Recordings and transcripts". Made once, with `--transcription`; its id then
 * goes in TWILIO_TRANSCRIPTION_SERVICE_SID. US English. Twilio's own "data
 * logging" - using our calls to train its models - is left off; it cannot be
 * switched on through the API anyway.
 */
async function ensureTranscriptionService(client: Client, configured: string | null): Promise<void> {
  if (configured) {
    console.log(`Transcription service ${configured} is set. Nothing changed.`);
    return;
  }
  const existing = (await client.intelligence.v2.services.list({ limit: 50 })).find((s) => s.uniqueName === SERVICE_NAME);
  const service =
    existing ??
    (await client.intelligence.v2.services.create({
      uniqueName: SERVICE_NAME,
      friendlyName: 'Secure Medical call transcripts',
      languageCode: 'en-US',
      autoTranscribe: false,
      dataLogging: false,
    }));
  console.log(`Transcription service "${service.uniqueName}" ${existing ? 'already exists' : 'created'}.`);
  console.log(`Put this in .env, then restart the api and worker:`);
  console.log(`  TWILIO_TRANSCRIPTION_SERVICE_SID=${service.sid}`);
}

type Client = ReturnType<typeof twilio>;

const show = (url: string | null | undefined): string => url || '(empty)';

async function pointTwimlApp(client: Client, twimlAppSid: string, voiceUrl: string): Promise<void> {
  const app = client.applications(twimlAppSid);
  const before = await app.fetch();
  if (before.voiceUrl === voiceUrl && before.voiceMethod === 'POST') {
    console.log(`TwiML App "${before.friendlyName}" already points at ${voiceUrl}. Nothing changed.`);
    return;
  }
  await app.update({ voiceUrl, voiceMethod: 'POST' });
  console.log(`TwiML App "${before.friendlyName}": Voice URL`);
  console.log(`  was ${show(before.voiceUrl)}`);
  console.log(`  now ${voiceUrl}`);
}

async function pointNumber(client: Client, phoneNumber: string, voiceUrl: string, takeOver: boolean): Promise<number> {
  const [number] = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
  if (!number) {
    console.error(`${phoneNumber} is not a number on this Twilio account. Check TWILIO_PHONE_NUMBER.`);
    return 1;
  }
  if (number.voiceUrl === voiceUrl && number.voiceMethod === 'POST' && !number.voiceApplicationSid) {
    console.log(`Number ${phoneNumber} already points at ${voiceUrl}. Nothing changed.`);
    return 0;
  }

  // Ours is an address ending in our own path - an earlier deployment or
  // tunnel. Anything else is somebody's working phone line.
  const elsewhere = number.voiceApplicationSid || (number.voiceUrl && !number.voiceUrl.endsWith(INCOMING_PATH));
  if (elsewhere && !takeOver) {
    console.error(`Number ${phoneNumber} already sends its calls somewhere else:`);
    console.error(`  ${number.voiceApplicationSid ? `TwiML App ${number.voiceApplicationSid}` : number.voiceUrl}`);
    console.error('Left alone. To point it at this app instead, run again with --take-over.');
    return 1;
  }

  // An application on the number wins over its Voice URL, so it is cleared.
  await client.incomingPhoneNumbers(number.sid).update({ voiceUrl, voiceMethod: 'POST', voiceApplicationSid: '' });
  console.log(`Number ${phoneNumber}: Voice URL`);
  console.log(`  was ${show(number.voiceUrl)}`);
  console.log(`  now ${voiceUrl}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
