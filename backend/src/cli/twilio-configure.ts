/**
 * Points our TwiML App's Voice URL at this deployment - Phase 4, TWILIO.md.
 *
 * Twilio asks that URL how to connect every call a browser starts, so it must
 * be this server's public address. Run it once after setting PUBLIC_URL, and
 * again whenever PUBLIC_URL changes (a new tunnel address locally):
 *
 *   docker compose exec api npm run dev:twilio:configure
 *   (production: npm run twilio:configure)
 *
 * It changes that one setting on the TwiML App named in TWILIO_TWIML_APP_SID
 * and nothing else on the account. Reads only the Twilio variables, so it runs
 * without a database.
 */
import twilio from 'twilio';
import { VOICE_PATH } from '../integrations/twilio';
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

  const { accountSid, authToken, twimlAppSid, publicUrl } = result.settings;
  const voiceUrl = publicUrl + VOICE_PATH;
  const app = twilio(accountSid, authToken).applications(twimlAppSid);

  const before = await app.fetch();
  if (before.voiceUrl === voiceUrl && before.voiceMethod === 'POST') {
    console.log(`TwiML App "${before.friendlyName}" already points at ${voiceUrl}. Nothing changed.`);
    return 0;
  }

  await app.update({ voiceUrl, voiceMethod: 'POST' });
  console.log(`TwiML App "${before.friendlyName}": Voice URL`);
  console.log(`  was ${before.voiceUrl || '(empty)'}`);
  console.log(`  now ${voiceUrl}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
