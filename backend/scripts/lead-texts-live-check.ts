/**
 * Proves db/lead-texts.ts against a real Postgres - the text after a missed
 * call, and the link a lead said yes to on the automated call (T14,
 * docs/AUTO-CALLS.md).
 *
 * What a mock cannot show: that the link's words are the active script's row,
 * and the missed-call text's the settings row, as the lead reads them; that
 * each lands on the lead's thread as a sent message; that a blocked number gets
 * neither and leaves no row; and that missing words send nothing.
 *
 * EZ Texting is stubbed at the HTTP boundary, not at sendMessage: replacing
 * sendMessage would remove the do-not-call check inside it, and this would then
 * "prove" a guard it had just deleted.
 *
 * It writes rows, so it refuses to run against a database that holds leads.
 * Run it with the others: scripts/live-checks.sh lead-texts
 */
import axios from 'axios';

let sent: { to: string[]; body: string }[] = [];
let stubId = 0;
(axios as { post: unknown }).post = async (_url: string, payload: { toNumbers: string[]; message: string }) => {
  sent.push({ to: payload.toNumbers, body: payload.message });
  return { data: { id: `stub-${++stubId}` } };
};

import { blockNumber, DNC_REASONS } from '../src/db/dnc';
import { sendCallLinkText, sendMissedCallText } from '../src/db/lead-texts';
import { pool } from '../src/db/pool';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  }
}

async function refuseIfNotEmpty(): Promise<void> {
  const { rows } = await pool.query(`SELECT count(*)::int AS leads FROM leads`);
  if (rows[0].leads > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }
}

async function makeLead(phone: string, firstName: string | null): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, ezt_added_at) VALUES ($1, $2, now()) RETURNING id`,
    [phone, firstName]
  );
  return rows[0].id;
}

/** The lead's texts, as their thread holds them. */
async function thread(leadId: number) {
  const { rows } = await pool.query(
    `SELECT direction, body, delivery_status, ezt_message_id IS NOT NULL AS has_id FROM messages WHERE lead_id = $1 ORDER BY id`,
    [leadId]
  );
  return rows;
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();
  const linkText = (await pool.query(`SELECT link_text FROM call_scripts WHERE is_active`)).rows[0].link_text as string;
  const missedTemplate = (await pool.query(`SELECT value FROM settings WHERE key = 'message_missed_call'`)).rows[0]
    .value as string;

  console.log('\nthe link (T14)');
  {
    const pat = await makeLead('+15550000601', 'Pat');
    sent = [];
    check('sent', await sendCallLinkText(pat), true);
    check('to the lead, in the script\'s own words', sent, [{ to: ['15550000601'], body: linkText }]);
    check('the anti-ez link, and how to stop', [linkText.includes('https://www.edrugstore.com/anti-ez'), /STOP/.test(linkText)], [true, true]);
    // Sent, as every automated text is marked: EZ Texting's id kept, no `sending` or `failed` left.
    check('on the lead\'s thread, as sent', await thread(pat), [
      { direction: 'outbound', body: linkText, delivery_status: null, has_id: true },
    ]);
  }

  console.log('\nthe text after a missed call - unchanged');
  {
    const sam = await makeLead('+15550000602', 'Sam');
    sent = [];
    check('sent', await sendMissedCallText(sam), true);
    const expected = missedTemplate.replace(/\{first_name\}/g, 'Sam');
    check('in the settings\' words, the name filled in', sent.map((s) => s.body), [expected]);
    check('on the lead\'s thread', (await thread(sam)).map((m) => m.body), [expected]);
  }

  console.log('\na blocked number gets neither');
  {
    const lee = await makeLead('+15550000603', 'Lee');
    await blockNumber(pool, '+15550000603', DNC_REASONS.callOptOut);
    sent = [];
    check('no link', await sendCallLinkText(lee), false);
    check('no missed-call text', await sendMissedCallText(lee), false);
    check('nothing reached EZ Texting', sent, []);
    check('and nothing on the thread', await thread(lee), []);
  }

  console.log('\nmissing words send nothing');
  {
    const kim = await makeLead('+15550000604', 'Kim');
    await pool.query(`UPDATE call_scripts SET is_active = false`);
    sent = [];
    check('no active script: no link', await sendCallLinkText(kim), false);
    await pool.query(`UPDATE call_scripts SET is_active = true WHERE key = 'antibiotics'`);

    await pool.query(`UPDATE settings SET key = 'message_missed_call_moved' WHERE key = 'message_missed_call'`);
    check('no missed-call words: no text', await sendMissedCallText(kim), false);
    await pool.query(`UPDATE settings SET key = 'message_missed_call' WHERE key = 'message_missed_call_moved'`);
    check('nothing reached EZ Texting', sent, []);

    check('an unknown lead: nothing', await sendCallLinkText(999999), false);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
