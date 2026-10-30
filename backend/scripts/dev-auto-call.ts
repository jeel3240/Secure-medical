/**
 * Local testing only: the server calls one lead, as the robot will - T12,
 * docs/AUTO-CALLS.md.
 *
 *   docker compose exec api npm run dev:auto-call -- +16025550123 [--again] [--unblock]
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
 * Testing needs more calls than that to one phone (T13), so two flags, both
 * for this local database only and neither touching the production path:
 *
 * - `--again`: when the lead holding the number has had its call, the number
 *   is given to a fresh test lead - as if the partner had sent it new - and
 *   that lead is called. The old lead keeps all its history under a made-up
 *   number, `+1555` and its id; nothing is deleted.
 * - `--unblock`: lifts the block a "stop" test left on the number, recorded as
 *   released for `dev_test`, so the next test can call it.
 *
 * A lead it calls has a text conversation, as every lead the poller saves
 * has: one with none - the fresh test lead, or one made by hand - is given
 * one, its first question marked as sent. Nothing is texted.
 *
 * Refuses in production - `NODE_ENV`: the file is not compiled into dist/, but
 * the server's image does hold scripts/.
 */
import { readAutoCalls, readAutoCallTestNumbers } from '../src/auto-calls-settings';
import { config } from '../src/config';
import { releaseNumber, RELEASE_REASONS } from '../src/db/dnc';
import { startConversation, type Db } from '../src/db/flows';
import { pool } from '../src/db/pool';
import { readExpiryDays } from '../src/db/sql';
import { placeAutoCall, type PlaceAutoCallResult } from '../src/worker/place-auto-call';
import { phoneFromArg } from './dev-phone';

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing: this is for local testing, never production.');
    return 1;
  }
  const args = process.argv.slice(2);
  const phone = phoneFromArg(args.find((a) => !a.startsWith('--')));
  const unknown = args.filter((a) => a.startsWith('--') && a !== '--again' && a !== '--unblock');
  if (!phone || unknown.length > 0) {
    console.error('Usage: npm run dev:auto-call -- <phone, e.g. +16025550123> [--again] [--unblock]');
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

  if (args.includes('--unblock') && (await releaseNumber(pool, phone, RELEASE_REASONS.devTest)) > 0) {
    console.log('The block on the number was lifted (released: dev_test).');
  }
  const leadId = args.includes('--again') ? await freshLeadIfCalled(phone) : await leadFor(phone);
  if (leadId === null) {
    console.error('No lead with that number in this database.');
    return 1;
  }
  if (await giveConversation(pool, leadId)) {
    console.log(`Lead ${leadId} had no text conversation: given one, its first question marked as sent - nothing was texted.`);
  }

  const numbers = readAutoCallTestNumbers(process.env, false);
  if (numbers.invalid > 0) {
    console.warn(`${numbers.invalid} entr${numbers.invalid === 1 ? 'y' : 'ies'} in AUTO_CALL_TEST_NUMBERS not E.164 - ignored.`);
  }
  const result = await placeAutoCall({ leadId, settings: config.twilio.settings, numbers });
  console.log(`Lead ${leadId}: ${describe(result)}`);
  return result.kind === 'placed' ? 0 : 1;
}

async function leadFor(phone: string): Promise<number | null> {
  const { rows } = await pool.query(`SELECT id FROM leads WHERE phone = $1`, [phone]);
  return rows[0]?.id ?? null;
}

/**
 * Gives the lead `leadId` a text conversation if it has none, as the poller
 * gives every lead it saves, with its first question marked as sent - as the
 * opener marks it once the text goes out (`worker/opener.ts`) - though nothing
 * is texted. So a test lead is what the robot calls: asked by text, no reply,
 * the reply window open. The queue then lists it once someone holds it - it
 * reads each lead's newest conversation, and a lead with none is left out -
 * and the opener retry never takes it for a first question that failed. True
 * when one was given.
 */
async function giveConversation(q: Db, leadId: number): Promise<boolean> {
  const { rows } = await q.query(`SELECT 1 FROM conversations WHERE lead_id = $1 LIMIT 1`, [leadId]);
  if (rows.length > 0) return false;
  await startConversation(q, leadId, 'open');
  const days = await readExpiryDays(q);
  await q.query(
    `UPDATE conversations
     SET expires_at = now() + ($2 || ' days')::interval, question_sent_at = now(), updated_at = now()
     WHERE lead_id = $1 AND status = 'open'`,
    [leadId, String(days)]
  );
  return true;
}

/**
 * The lead to call for `--again`: the one holding the number, unless it has
 * had its automated call - then a fresh test lead with the same name takes the
 * number, and the old one keeps its history under `+1555` and its id. One
 * transaction, with the old lead locked.
 */
async function freshLeadIfCalled(phone: string): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT l.id, l.first_name, l.last_name,
              EXISTS (SELECT 1 FROM calls c WHERE c.lead_id = l.id AND c.direction = 'automated') AS called
       FROM leads l WHERE l.phone = $1 FOR UPDATE`,
      [phone]
    );
    const old = rows[0];
    if (!old || !old.called) {
      await client.query('COMMIT');
      return old?.id ?? null;
    }
    await client.query(`UPDATE leads SET phone = '+1555' || lpad(id::text, 7, '0') WHERE id = $1`, [old.id]);
    const fresh = await client.query(
      `INSERT INTO leads (phone, first_name, last_name, source, ezt_added_at)
       VALUES ($1, $2, $3, 'dev_test', now()) RETURNING id`,
      [phone, old.first_name, old.last_name]
    );
    await client.query('COMMIT');
    console.log(`Lead ${old.id} has had its call: the number now belongs to fresh test lead ${fresh.rows[0].id}.`);
    return fresh.rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function describe(result: PlaceAutoCallResult): string {
  switch (result.kind) {
    case 'placed':
      return `placed, call ${result.callId}: the phone should ring now. How it ends is saved to the call.`;
    case 'refused':
      return `not placed: ${result.reason}.${result.reason === 'already_called' ? ' Add --again to call a fresh test lead.' : result.reason === 'blocked' ? ' Add --unblock to lift a test block.' : ''}`;
    case 'failed':
      return `Twilio refused the number for call ${result.callId}; it is saved as failed.`;
    case 'notPlaced':
      return `Twilio refused call ${result.callId} for the account's reasons; saved as failed, not the lead's call.`;
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
