/**
 * Local testing only: the server calls one lead, as the robot will - T12,
 * docs/AUTO-CALLS.md.
 *
 *   docker compose exec api npm run dev:auto-call -- +16025550123
 *
 * The lead must already be in the local database with that number, and the
 * number must be on `AUTO_CALL_TEST_NUMBERS` - outside production nothing else
 * is ever rung. It needs what the call's webhooks need, read from the same
 * environment as the api answering them: calling set up with a public address
 * Twilio can reach (a tunnel), and `AUTO_CALLS=on`.
 *
 * One automated call per lead, as in production: a lead already called is
 * refused. Placed through `worker/place-auto-call.ts`, the dialler's own path.
 *
 * Refuses in production - `NODE_ENV`: the file is not compiled into dist/, but
 * the server's image does hold scripts/.
 */
import { readAutoCalls, readAutoCallTestNumbers } from '../src/auto-calls-settings';
import { config } from '../src/config';
import { pool } from '../src/db/pool';
import { placeAutoCall, type PlaceAutoCallResult } from '../src/worker/place-auto-call';
import { phoneFromArg } from './dev-phone';

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing: this is for local testing, never production.');
    return 1;
  }
  const phone = phoneFromArg(process.argv[2]);
  if (!phone) {
    console.error('Usage: npm run dev:auto-call -- <phone, e.g. +16025550123>');
    return 1;
  }
  if (config.twilio.status !== 'on') {
    console.error('Calling is not set up: the Twilio settings and PUBLIC_URL (a tunnel) are needed. docs/TWILIO.md.');
    return 1;
  }
  if (!readAutoCalls(process.env).on) {
    console.error('AUTO_CALLS is not "on": the call\'s webhooks would not answer. docs/AUTO-CALLS.md.');
    return 1;
  }

  const { rows } = await pool.query(`SELECT id FROM leads WHERE phone = $1`, [phone]);
  if (!rows[0]) {
    console.error('No lead with that number in this database.');
    return 1;
  }

  const numbers = readAutoCallTestNumbers(process.env, false);
  if (numbers.invalid > 0) {
    console.warn(`${numbers.invalid} entr${numbers.invalid === 1 ? 'y' : 'ies'} in AUTO_CALL_TEST_NUMBERS not E.164 - ignored.`);
  }
  const result = await placeAutoCall({ leadId: rows[0].id, settings: config.twilio.settings, numbers });
  console.log(`Lead ${rows[0].id}: ${describe(result)}`);
  return result.kind === 'placed' ? 0 : 1;
}

function describe(result: PlaceAutoCallResult): string {
  switch (result.kind) {
    case 'placed':
      return `placed, call ${result.callId}: the phone should ring now. How it ends is saved to the call.`;
    case 'refused':
      return `not placed: ${result.reason}.`;
    case 'failed':
      return `Twilio refused call ${result.callId}; it is saved as failed.`;
    case 'unconfirmed':
      return `Twilio did not answer in time: call ${result.callId} may or may not have gone out.`;
  }
}

main()
  .then((code) => pool.end().then(() => process.exit(code)))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
