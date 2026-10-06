/**
 * Local testing only: asks a lead we already hold the questions again, from
 * the first one, so one phone can walk every path of a flow.
 *
 *   docker compose exec api npm run dev:ask-again -- +16025550123
 *
 * The poller skips a number it already holds - repeat leads are not built,
 * docs/POLLER.md - so without this a second walk needs a second phone or an
 * emptied database.
 *
 * In one transaction the lead's open conversation, if it has one, is marked
 * expired - one open conversation per number, ever - and a new one is started
 * in the flow new leads get. Then the first question is sent, the way the
 * poller sends it. Nothing is deleted: the earlier conversations and their
 * answers stay, and so does whatever agents did with the lead.
 *
 * Refuses in production, and is not in the production build: scripts/ is
 * never compiled into dist/. docs/FLOWS.md, "Testing a flow with one phone".
 */
import '../src/config';
import { openingQuestion, startConversation } from '../src/db/flows';
import { pool } from '../src/db/pool';
import { sendOpener } from '../src/worker/opener';

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing: this is for local testing, never production.');
    return 1;
  }

  const digits = (process.argv[2] ?? '').replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 11) {
    console.error('Usage: npm run dev:ask-again -- <phone, e.g. +16025550123>');
    return 1;
  }
  const phone = `+${digits.length === 10 ? `1${digits}` : digits}`;

  const { rows } = await pool.query(
    `SELECT l.id, l.first_name,
            EXISTS (SELECT 1 FROM dnc_list d WHERE d.phone = l.phone AND d.released_at IS NULL) AS blocked
     FROM leads l WHERE l.phone = $1`,
    [phone]
  );
  const lead = rows[0];
  if (!lead) {
    console.error(`No lead with ${phone}. Add it to the EZ Texting group and let the poller bring it in first.`);
    return 1;
  }
  if (lead.blocked) {
    console.error(`${phone} is blocked. Text START from that phone first, then run this again.`);
    return 1;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE conversations SET status = 'expired', updated_at = now() WHERE lead_id = $1 AND status = 'open'`,
      [lead.id]
    );
    await startConversation(client, lead.id, 'open');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const template = await openingQuestion(pool, lead.id);
  if (!template) {
    console.error('The new conversation has no first question to send.');
    return 1;
  }
  const result = await sendOpener({ id: lead.id, phone, firstName: lead.first_name }, template);
  if (!result.sent) {
    console.error(`Lead ${lead.id}: a new conversation was started, but the first question was not sent.`);
    return 1;
  }
  console.log(`Lead ${lead.id}: asked again from the first question.`);
  return 0;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
