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
 * It changes those two settings and nothing else on the account. Reads only
 * the Twilio variables, so it runs without a database.
 *
 * **It refuses to move what another server relies on** - core/twilio-pointing.ts
 * decides, for the app and the number alike: this app on another real server
 * (production, run from a laptop), an address that is not this app, or a
 * number answered by another TwiML App. Both are decided before either is
 * changed, so a refusal never leaves them half-moved. `--take-over` overrides.
 *
 * `--dry-run` says what it would change, and changes nothing.
 *
 * `--transcription` also makes the transcription service that call transcripts
 * go through, if there is none yet, and prints its id for `.env`.
 *
 * **Never run this locally with production's number or TwiML App** - Jeel,
 * 2026-10-05. Local testing has its own, (480) 530-8582 (TWILIO.md). Until
 * 2026-10-16 nothing here stopped it - a laptop and production share the
 * webhook paths - and the refusal above is a second line, not a reason to try.
 *
 * **One number, one deployment.** The number can ring only one address.
 */
import twilio from 'twilio';
import { decidePointing, type Pointing } from '../core/twilio-pointing';
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
  const takeOver = process.argv.includes('--take-over');
  const dryRun = process.argv.includes('--dry-run');
  const client = twilio(accountSid, authToken);

  // Everything is looked at and decided first; nothing is changed unless both
  // may be.
  const app = await client.applications(twimlAppSid).fetch();
  const [number] = await client.incomingPhoneNumbers.list({ phoneNumber: callerId, limit: 1 });
  if (!number) {
    console.error(`${callerId} is not a number on this Twilio account. Check TWILIO_PHONE_NUMBER.`);
    return 1;
  }

  const appUrl = publicUrl + VOICE_PATH;
  const numberUrl = publicUrl + INCOMING_PATH;
  const plans: Plan[] = [
    {
      what: `TwiML App "${app.friendlyName}"`,
      was: app.voiceUrl,
      target: appUrl,
      decision: decidePointing({ voiceUrl: app.voiceUrl, voiceMethod: app.voiceMethod }, appUrl, takeOver),
      apply: () => client.applications(twimlAppSid).update({ voiceUrl: appUrl, voiceMethod: 'POST' }),
    },
    {
      what: `Number ${callerId}`,
      was: number.voiceUrl,
      target: numberUrl,
      decision: decidePointing(
        { voiceUrl: number.voiceUrl, voiceMethod: number.voiceMethod, applicationSid: number.voiceApplicationSid },
        numberUrl,
        takeOver
      ),
      // An application on the number wins over its Voice URL, so it is cleared.
      apply: () =>
        client.incomingPhoneNumbers(number.sid).update({ voiceUrl: numberUrl, voiceMethod: 'POST', voiceApplicationSid: '' }),
    },
  ];

  const refusals = plans.flatMap((plan) => (plan.decision.action === 'refuse' ? [refusal(plan.what, plan.decision)] : []));
  if (refusals.length > 0) {
    for (const message of refusals) console.error(message);
    console.error('Nothing was changed.');
    return 1;
  }

  for (const plan of plans) {
    if (plan.decision.action === 'unchanged') {
      console.log(`${plan.what} already points at ${plan.target}. Nothing to change.`);
      continue;
    }
    if (!dryRun) await plan.apply();
    console.log(`${plan.what}: Voice URL${dryRun ? ' would change' : ''}`);
    console.log(`  was ${show(plan.was)}`);
    console.log(`  now ${plan.target}`);
  }
  if (dryRun) console.log('Dry run: nothing was changed.');

  if (process.argv.includes('--transcription')) {
    await ensureTranscriptionService(client, result.settings.transcriptionServiceSid ?? null, dryRun);
  }
  return 0;
}

interface Plan {
  what: string;
  was: string | null | undefined;
  target: string;
  decision: Pointing;
  apply: () => Promise<unknown>;
}

type Refusal = Extract<Pointing, { action: 'refuse' }>;

function refusal(what: string, decision: Refusal): string {
  switch (decision.why) {
    case 'other_server':
      return (
        `${what} points at this app on another server:\n  ${decision.current}\n` +
        `Moving it here would take that server's calls - production's, most likely. ` +
        `If that is really what you want, run again with --take-over.`
      );
    case 'other_app':
      return `${what} sends its calls to ${decision.current}. To point it at this app instead, run again with --take-over.`;
    case 'elsewhere':
      return `${what} sends its calls somewhere else:\n  ${decision.current}\nTo point it at this app instead, run again with --take-over.`;
  }
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
async function ensureTranscriptionService(client: Client, configured: string | null, dryRun: boolean): Promise<void> {
  if (configured) {
    console.log(`Transcription service ${configured} is set. Nothing changed.`);
    return;
  }
  const existing = (await client.intelligence.v2.services.list({ limit: 50 })).find((s) => s.uniqueName === SERVICE_NAME);
  if (dryRun && !existing) {
    console.log(`Transcription service "${SERVICE_NAME}" would be created.`);
    return;
  }
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

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
