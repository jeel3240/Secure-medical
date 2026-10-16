/**
 * Proves worker/send-waiting-openers.ts against a real Postgres.
 *
 * What mocks cannot show: which leads the query really finds after an outage,
 * that it never takes a lead the retry may still send to, that a lead is never
 * texted twice across runs, that it keeps its pace and stops at the first
 * refusal, and that a lead which changes while it runs is skipped. Getting any
 * of those wrong texts someone twice, texts someone who said stop, or texts a
 * lead an agent is already talking to.
 *
 * EZ Texting is stubbed at the HTTP boundary, not at sendMessage, so the
 * do-not-call check inside sendMessage stays in the path - as in
 * retry-openers-live-check.ts. The clock and the pause are stand-ins, so the
 * check runs in seconds and the pace is measured exactly.
 *
 * It writes rows, so it refuses to run against a database that holds any.
 * Run it with the others: scripts/live-checks.sh send-waiting-openers
 */
import axios from 'axios';

let sent: string[] = [];
let failNext: Error | null = null;
let stubId = 0;

(axios as { post: unknown }).post = async (_url: string, payload: { toNumbers: string[] }) => {
  if (failNext) {
    const err = failNext;
    failNext = null;
    throw err;
  }
  sent.push(payload.toNumbers[0]);
  return { data: { id: `stub-${++stubId}` } };
};

import { blockNumber, DNC_REASONS } from '../src/db/dnc';
import { startConversation } from '../src/db/flows';
import { pool } from '../src/db/pool';
import { retryFailedOpeners } from '../src/worker/retry-openers';
import { resendWaitingOpeners, type ResendDeps, type ResendReport } from '../src/worker/send-waiting-openers';

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

const EVERY_MS = 30_000;
const WINDOW = { from: new Date(Date.now() - 72 * 3_600_000), to: new Date(Date.now() + 60_000) };

/** A clock that only moves when the command pauses, and a record of each pause. */
let clock = Date.now();
let slept: number[] = [];
let whileWaiting: (() => Promise<void>) | null = null;
let printed: string[] = [];

const deps: ResendDeps = {
  print: (line) => printed.push(line),
  now: () => clock,
  sleep: async (ms) => {
    slept.push(ms);
    clock += ms;
    if (whileWaiting) {
      const hook = whileWaiting;
      whileWaiting = null;
      await hook();
    }
  },
};

async function resend(opts: { dryRun?: boolean; limit?: number } = {}): Promise<ResendReport> {
  sent = [];
  slept = [];
  printed = [];
  return resendWaitingOpeners(
    { ...WINDOW, everyMs: EVERY_MS, limit: opts.limit ?? null, dryRun: opts.dryRun ?? false },
    deps
  );
}

/**
 * A lead whose opener failed, as the block left them: arrived `hoursAgo`, on
 * the flow's first question, with `attempts` failed automated texts, the last
 * one when it arrived.
 */
async function waitingLead(phone: string, hoursAgo: number, attempts: number): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, source, ezt_added_at)
     VALUES ($1, 'Jordan', 'API', now() - ($2 || ' hours')::interval) RETURNING id`,
    [phone, String(hoursAgo)]
  );
  const id = rows[0].id as number;
  await startConversation(pool, id, 'open');
  for (let i = 0; i < attempts; i++) {
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, delivery_status, created_at)
       VALUES ($1, 'outbound', 'opener that failed', 'failed', now() - ($2 || ' hours')::interval)`,
      [id, String(hoursAgo)]
    );
  }
  return id;
}

const conversationOf = async (leadId: number) =>
  (await pool.query(`SELECT expires_at, question_sent_at FROM conversations WHERE lead_id = $1`, [leadId])).rows[0];

const ids = (report: ResendReport) => report.waiting.map((lead) => lead.leadId);

async function main(): Promise<void> {
  const { rows: existing } = await pool.query(`SELECT count(*)::int AS n FROM leads`);
  if (existing[0].n > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }

  const { rows: u } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ('agent@x.test', 'x', 'Agent', 'agent') RETURNING id`
  );
  const agent = u[0].id as number;

  // What the block left behind. Oldest first: A, B, C.
  const a = await waitingLead('+15550001001', 40, 5); // given up: attempts used, and too old
  const b = await waitingLead('+15550001002', 30, 1); // given up: too old
  const c = await waitingLead('+15550001003', 20, 5); // given up: attempts used
  const d = await waitingLead('+15550001004', 2, 2); // still the retry's: 2 attempts, 2 hours old

  // Each of these is waiting too, but must not be sent to.
  const replied = await waitingLead('+15550001010', 30, 5);
  await pool.query(
    `INSERT INTO messages (lead_id, direction, body, from_number, received_at) VALUES ($1, 'inbound', 'hi', '+15550001010', now())`,
    [replied]
  );
  const maybeSent = await waitingLead('+15550001011', 30, 5);
  await pool.query(
    `INSERT INTO messages (lead_id, direction, body, delivery_status) VALUES ($1, 'outbound', 'opener', 'sending')`,
    [maybeSent]
  );
  await waitingLead('+15550001012', 30, 5);
  await blockNumber(pool, '+15550001012', DNC_REASONS.smsStop);
  const held = await waitingLead('+15550001013', 30, 5);
  await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [held, agent]);
  const called = await waitingLead('+15550001014', 30, 5);
  await pool.query(
    `INSERT INTO calls (lead_id, direction, outcome, started_at) VALUES ($1, 'inbound', 'missed', now())`,
    [called]
  );
  const closed = await waitingLead('+15550001015', 30, 5);
  await pool.query(`INSERT INTO dispositions (lead_id, agent_id, value) VALUES ($1, $2, 'closed')`, [closed, agent]);
  const noted = await waitingLead('+15550001016', 30, 5);
  await pool.query(`INSERT INTO notes (lead_id, agent_id, body) VALUES ($1, $2, 'left a message')`, [noted, agent]);
  const booked = await waitingLead('+15550001017', 30, 5);
  await pool.query(`INSERT INTO callbacks (lead_id, agent_id, scheduled_at) VALUES ($1, $2, now())`, [booked, agent]);
  const agentTried = await waitingLead('+15550001018', 30, 5);
  await pool.query(
    `INSERT INTO messages (lead_id, direction, body, delivery_status, sent_by) VALUES ($1, 'outbound', 'hi', 'failed', $2)`,
    [agentTried, agent]
  );
  await waitingLead('+15550001019', 80, 5); // arrived before the window

  const expired = await waitingLead('+15550001020', 50, 5);
  await pool.query(`UPDATE conversations SET status = 'expired' WHERE lead_id = $1`, [expired]);

  const fine = await waitingLead('+15550001021', 30, 1);
  await pool.query(`UPDATE conversations SET expires_at = now() + interval '7 days' WHERE lead_id = $1`, [fine]);
  await pool.query(
    `INSERT INTO messages (lead_id, direction, body, ezt_message_id) VALUES ($1, 'outbound', 'opener', 'real-1')`,
    [fine]
  );

  console.log('\nthe retry and the resend never share a lead');
  {
    // D is two attempts in and its next is due: the retry's to send, not ours.
    const dry = await resend({ dryRun: true });
    check('the resend does not list a lead the retry may still send to', ids(dry).includes(d), false);
    sent = [];
    await retryFailedOpeners();
    check('and the retry sends only that one, none of those given up on', sent, ['15550001004']);
  }

  console.log('\na dry run');
  {
    const report = await resend({ dryRun: true });
    check('lists exactly the leads the retry gave up on, oldest first', ids(report), [a, b, c]);
    check('says why the retry will not send each', report.waiting.map((l) => l.why), ['abandoned', 'tooOld', 'abandoned']);
    check('lists apart the lead that expired without a first text', report.expiredWithoutOpener.map((l) => l.leadId), [expired]);
    check('sends nothing', sent, []);
    check('and says so', printed[printed.length - 1], 'Dry run: nothing was sent.');
    check('the reply windows are still unopened', (await conversationOf(a)).expires_at, null);
  }

  console.log('\nnever a lead a person has worked, replied, blocked or maybe already texted');
  {
    const report = await resend({ dryRun: true });
    for (const [label, leadId] of [
      ['replied', replied],
      ['a text still sending', maybeSent],
      ['picked up', held],
      ['called', called],
      ['closed', closed],
      ['noted', noted],
      ['a callback booked', booked],
      ['an agent tried to text', agentTried],
      ['already sent its opener', fine],
    ] as const) {
      check(`not listed: ${label}`, ids(report).includes(leadId), false);
    }
    check('not listed: a blocked number, nor one from before the window', report.waiting.length, 3);
  }

  console.log('\n--limit 1 sends only the oldest');
  {
    const report = await resend({ limit: 1 });
    check('one text', sent, ['15550001001']);
    check('counted', report.sent, 1);
    check('no pause before the first text', slept, []);
    const conv = await conversationOf(a);
    check('its reply window opens now', conv.expires_at !== null && conv.question_sent_at !== null, true);
    check('and the rest are said to be waiting', printed.some((line) => line.startsWith('2 still waiting')), true);
  }

  console.log('\nrun again: the rest, at the pace, and nothing twice');
  {
    const report = await resend();
    check('the lead already sent to is no longer listed', ids(report), [b, c]);
    check('the other two are sent, oldest first', sent, ['15550001002', '15550001003']);
    check('one pause of --every between them, none before the first', slept, [EVERY_MS]);
    check('nothing is still waiting', printed.some((line) => line.includes('still waiting')), false);

    const again = await resend();
    check('a third run finds nobody', again.waiting.length, 0);
    check('and sends nothing', sent, []);
  }

  console.log('\nit stops at the first refusal, and carries on when run again');
  {
    const p = await waitingLead('+15550001030', 60, 5);
    await waitingLead('+15550001031', 59, 5);
    failNext = new Error('upstream 503');
    const report = await resend();
    check('stopped at the refused lead', report.stoppedAt?.leadId, p);
    check('because it was refused', report.stoppedAt?.reason, 'refused');
    check('the next lead is not tried', sent, []);

    const after = await resend();
    check('run again, both go', sent, ['15550001030', '15550001031']);
    check('and it finishes', after.stoppedAt, null);
  }

  console.log('\nit stops at a text EZ Texting did not answer, and never sends that one again');
  {
    const r = await waitingLead('+15550001040', 58, 5);
    await waitingLead('+15550001041', 57, 5);
    failNext = Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
    const report = await resend();
    check('stopped as unconfirmed', [report.stoppedAt?.leadId, report.stoppedAt?.reason], [r, 'unconfirmed']);

    const after = await resend();
    // Its row is still 'sending': it may have reached the lead.
    check('the unconfirmed lead is not listed again', ids(after).includes(r), false);
    check('the next one is sent', sent, ['15550001041']);
  }

  console.log('\na lead that changes while it runs is skipped');
  {
    await waitingLead('+15550001050', 56, 5);
    const u2 = await waitingLead('+15550001051', 55, 5);
    await waitingLead('+15550001052', 54, 5);
    // During the pause after the first text: U replies, and V is blocked.
    whileWaiting = async () => {
      await pool.query(
        `INSERT INTO messages (lead_id, direction, body, from_number, received_at) VALUES ($1, 'inbound', '1', '+15550001051', now())`,
        [u2]
      );
      await blockNumber(pool, '+15550001052', DNC_REASONS.smsStop);
    };
    const report = await resend();
    check('only the first is sent', sent, ['15550001050']);
    check('the other two are skipped', report.skipped, 2);
    // V's turn needed no second pause: U was skipped, not sent.
    check('one pause in all - a skipped lead does not make the next wait', slept, [EVERY_MS]);
  }

  console.log('\none run at a time');
  {
    await waitingLead('+15550001060', 53, 5);
    const other = await pool.connect();
    await other.query(`SELECT pg_advisory_lock(hashtext('send-waiting-openers'))`);
    const report = await resend();
    check('a second run is refused', report.busy, true);
    check('and sends nothing', sent, []);
    await other.query(`SELECT pg_advisory_unlock(hashtext('send-waiting-openers'))`);
    other.release();

    const after = await resend();
    check('once the first is over, it runs', after.sent, 1);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
