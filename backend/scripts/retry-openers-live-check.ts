/**
 * Proves worker/retry-openers.ts against a real Postgres.
 *
 * What mocks cannot show: which leads the query actually finds, that a lead
 * whose opener succeeded is never picked up again, that the backoff holds
 * against a real clock, and that a blocked number is left alone. Getting any of
 * those wrong means either texting someone twice or never texting them at all.
 *
 * EZ Texting is stubbed at the HTTP boundary, not at sendMessage: replacing
 * sendMessage would remove the dnc_list check that lives inside it, and the
 * script would then "prove" a compliance guard it had just deleted.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE retry_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/retry_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/retry_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x EZT_SEND_GROUP=x \
 *     npx ts-node --transpile-only scripts/retry-openers-live-check.ts
 */
import axios from 'axios';

let sent: { to: string[]; body: string }[] = [];
let failNext: Error | null = null;
let stubId = 0;

(axios as { post: unknown }).post = async (
  _url: string,
  payload: { toNumbers: string[]; message: string }
) => {
  if (failNext) {
    const err = failNext;
    failNext = null;
    throw err;
  }
  sent.push({ to: payload.toNumbers, body: payload.message });
  return { data: { id: `stub-${++stubId}` } };
};

import { startConversation } from '../src/db/flows';
import { pool } from '../src/db/pool';
import { retryFailedOpeners } from '../src/worker/retry-openers';
import { blockNumber, DNC_REASONS } from '../src/db/dnc';

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
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM leads`);
  if (rows[0].n > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }
}

/**
 * A lead whose opener failed: conversation open, no expiry, and one failed
 * message row per attempt already made. The failures are stamped when the
 * lead arrived unless `lastFailedMinutesAgo` says otherwise - the wait before
 * the next retry counts from the last one.
 */
async function leadWithFailedOpener(
  phone: string,
  opts: { minutesAgo: number; attempts?: number; lastFailedMinutesAgo?: number }
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, source, ezt_added_at)
     VALUES ($1, 'Jordan', 'API', now() - ($2 || ' minutes')::interval) RETURNING id`,
    [phone, String(opts.minutesAgo)]
  );
  const id = rows[0].id;

  // In the active flow, on its first question - as the poller leaves a new lead.
  await startConversation(pool, id, 'open');

  const failedAgo = String(opts.lastFailedMinutesAgo ?? opts.minutesAgo);
  for (let i = 0; i < (opts.attempts ?? 1); i++) {
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, delivery_status, created_at)
       VALUES ($1, 'outbound', 'opener that failed', 'failed', now() - ($2 || ' minutes')::interval)`,
      [id, failedAgo]
    );
  }
  return id;
}

const expiryOf = async (leadId: number) =>
  (await pool.query(`SELECT expires_at FROM conversations WHERE lead_id = $1`, [leadId])).rows[0]
    .expires_at;

const outboundCount = async (leadId: number) =>
  (
    await pool.query(
      `SELECT count(*)::int AS n FROM messages
       WHERE lead_id = $1 AND direction = 'outbound' AND delivery_status IS DISTINCT FROM 'failed'`,
      [leadId]
    )
  ).rows[0].n;

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  console.log('\na lead whose opener failed, now due');
  {
    sent = [];
    // Failed on arrival 10 minutes ago: the first retry is due 5 minutes after.
    const lead = await leadWithFailedOpener('+15550000901', { minutesAgo: 10, attempts: 1 });

    const stats = await retryFailedOpeners();

    check('is found', stats.due, 1);
    check('and sent', stats.sent, 1);
    check('the text went out', sent.length, 1);
    check('a real outbound row is recorded', await outboundCount(lead), 1);
    // The lead is only being asked now, so the seven days run from here.
    check('the reply window opens', (await expiryOf(lead)) !== null, true);
  }

  console.log('\nand is not retried once it has gone out');
  {
    sent = [];
    const stats = await retryFailedOpeners();
    check('nothing is due', stats.due, 0);
    check('nothing is sent', sent.length, 0);
  }

  console.log('\nthe backoff');
  {
    sent = [];
    // Failed 2 minutes ago: the first retry is not due until 5.
    const early = await leadWithFailedOpener('+15550000902', { minutesAgo: 2, attempts: 1 });
    const stats = await retryFailedOpeners();

    check('a lead inside its wait is skipped', stats.due, 0);
    check('and nothing is sent to it', sent.length, 0);
    check('its opener is still missing', await outboundCount(early), 0);

    // Move that failure past the 5-minute mark and it becomes due.
    await pool.query(
      `UPDATE messages SET created_at = now() - interval '6 minutes' WHERE lead_id = $1`,
      [early]
    );
    const after = await retryFailedOpeners();
    check('past the wait it is sent', after.sent, 1);
  }

  console.log('\nthe wait counts from the last failure, not from arrival');
  {
    sent = [];
    // Arrived 10 hours ago - older than the whole schedule - with two failures,
    // the last a minute ago. Counted from arrival every wait has "passed", and
    // it used to be retried on every tick: four retries in four minutes. From
    // the last failure it is due in 30 minutes. Found in review, 2026-09-28.
    const recent = await leadWithFailedOpener('+15550000910', {
      minutesAgo: 600,
      attempts: 2,
      lastFailedMinutesAgo: 1,
    });
    const stats = await retryFailedOpeners();
    check('a failure a minute ago is not retried yet', stats.due, 0);
    check('and nothing is sent', sent.length, 0);

    await pool.query(
      `UPDATE messages SET created_at = now() - interval '31 minutes' WHERE lead_id = $1`,
      [recent]
    );
    check('31 minutes later it is', (await retryFailedOpeners()).sent, 1);
  }

  console.log('\ntoo old for a first question');
  {
    sent = [];
    // Arrived 30 hours ago; its opener never went out and was never retried -
    // the worker was down, or it predates this code. "You asked about health &
    // wellness" a day and a half later reads as broken. Found in review,
    // 2026-09-28: without the cap the first deploy would text every such lead.
    const stale = await leadWithFailedOpener('+15550000911', { minutesAgo: 30 * 60, attempts: 1 });
    const stats = await retryFailedOpeners();
    check('is counted as too old', stats.tooOld, 1);
    check('and is not texted', sent.length, 0);
    check('no opener is recorded', await outboundCount(stale), 0);
  }

  console.log('\nfrom review, 2026-09-28');
  {
    const { rows: u } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ('agent@x.test', 'x', 'Agent', 'agent') RETURNING id`
    );
    const agent = u[0].id;

    // An agent's own refused texts are not opener attempts. Before the fix
    // three of them plus the poller's own attempt made four, and the lead
    // was one step from being given up on.
    sent = [];
    const texted = await leadWithFailedOpener('+15550000912', { minutesAgo: 10, attempts: 1 });
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO messages (lead_id, direction, body, delivery_status, sent_by, created_at)
         VALUES ($1, 'outbound', 'agent text', 'failed', $2, now() - interval '1 minute')`,
        [texted, agent]
      );
    }
    const s1 = await retryFailedOpeners();
    check("an agent's failed texts do not count as attempts: still retried", sent.map((x) => x.to[0]), ['15550000912']);
    check('and not abandoned', s1.abandoned, 0);

    // A lead who replied anyway has moved on; question 1 again would be scored
    // as the answer to question 2.
    sent = [];
    const replied = await leadWithFailedOpener('+15550000913', { minutesAgo: 10, attempts: 1 });
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, from_number, received_at) VALUES ($1, 'inbound', 'hi', '+15550000913', now())`,
      [replied]
    );
    await retryFailedOpeners();
    check('a lead who replied is never sent question 1 again', sent.length, 0);

    // A text that may have gone out - its row still 'sending' because the
    // write after the send failed - is never sent again.
    sent = [];
    const maybe = await leadWithFailedOpener('+15550000914', { minutesAgo: 10, attempts: 1 });
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, delivery_status) VALUES ($1, 'outbound', 'opener', 'sending')`,
      [maybe]
    );
    await retryFailedOpeners();
    check('a text still marked sending is not retried', sent.length, 0);
  }

  console.log('\ngiving up');
  {
    sent = [];
    // Five attempts already made: past the last step of the backoff.
    const done = await leadWithFailedOpener('+15550000903', { minutesAgo: 1000, attempts: 5 });
    const stats = await retryFailedOpeners();

    // Exactly 1: the too-old lead above is counted apart, as tooOld.
    check('is abandoned, not retried', stats.abandoned, 1);
    check('nothing is sent', sent.length, 0);
    check('and no opener is recorded', await outboundCount(done), 0);
  }

  console.log('\na blocked number');
  {
    sent = [];
    const blocked = await leadWithFailedOpener('+15550000904', { minutesAgo: 60, attempts: 1 });
    await blockNumber(pool, '+15550000904', DNC_REASONS.smsStop);

    const stats = await retryFailedOpeners();
    check('is never due', stats.due, 0);
    // Honouring an opt-out is not optional, and a retry loop is exactly where
    // a forgotten check would text someone who said stop.
    check('and nothing is sent', sent.length, 0);
    check('no opener is recorded', await outboundCount(blocked), 0);
  }

  console.log('\na lead whose opener already succeeded');
  {
    sent = [];
    const { rows } = await pool.query(
      `INSERT INTO leads (phone, first_name, source, ezt_added_at)
       VALUES ('+15550000905', 'Casey', 'API', now() - interval '1 hour') RETURNING id`
    );
    const fine = rows[0].id;
    await pool.query(
      `SELECT 1`
    );
    await startConversation(pool, fine, 'open');
    await pool.query(`UPDATE conversations SET expires_at = now() + interval '7 days' WHERE lead_id = $1`, [fine]);
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, ezt_message_id)
       VALUES ($1, 'outbound', 'the opener', 'real-1')`,
      [fine]
    );

    const stats = await retryFailedOpeners();
    // Texting a lead their opener twice is worse than not retrying at all.
    check('is never picked up', stats.due, 0);
    check('and nothing is sent', sent.length, 0);
  }

  console.log('\nwhen the send fails again');
  {
    sent = [];
    const lead = await leadWithFailedOpener('+15550000906', { minutesAgo: 60, attempts: 1 });
    failNext = new Error('upstream 503');

    const stats = await retryFailedOpeners();

    check('the failure is counted', stats.failed, 1);
    check('nothing is recorded as sent', await outboundCount(lead), 0);
    // The extra failed row is what moves the lead to the next backoff step.
    const attempts = (
      await pool.query(
        `SELECT count(*)::int AS n FROM messages
         WHERE lead_id = $1 AND delivery_status = 'failed'`,
        [lead]
      )
    ).rows[0].n;
    check('and the attempt is remembered', attempts, 2);
  }

  console.log('\nthe oldest lead goes first');
  {
    sent = [];
    const older = await leadWithFailedOpener('+15550000907', { minutesAgo: 600, attempts: 1 });
    const newer = await leadWithFailedOpener('+15550000908', { minutesAgo: 60, attempts: 1 });

    await retryFailedOpeners();
    const first = sent[0]?.to[0];
    // Longest-waiting first: they have been silent the longest.
    check('the longest-waiting lead is contacted first', first, '15550000907');
    check('older got an opener', await outboundCount(older), 1);
    check('newer got an opener', await outboundCount(newer), 1);
    // Exactly these two. The lead from the failed-send section above failed a
    // moment ago, so its next retry is 30 minutes off. Until the review fix it
    // was retried here too - counted from arrival, its wait had "passed" - and
    // this check asserted that as correct.
    check('exactly these two were sent', sent.map((s) => s.to[0]).sort(), ['15550000907', '15550000908']);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
