/**
 * Proves db/read-flag.ts against a real Postgres, and - the point of the task -
 * that clearing the flag actually drops an expired lead out of the queue.
 *
 * The jest tests mock the database, so they show the route's status codes and
 * nothing about the effect. The effect is the whole reason the endpoint exists:
 * an expired conversation is closed, and a lead who texts afterwards is kept in
 * the queue only by `has_unread_inbound`. Until now nothing cleared it, so such
 * a lead never left.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE read_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/read_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/read_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/read-flag-live-check.ts
 */
import { pool } from '../src/db/pool';
import { markLeadRead } from '../src/db/read-flag';
import { listQueue } from '../src/db/queue';

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

/** A lead whose conversation expired, who has since texted back. */
async function makeExpiredLeadWithReply(phone: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, has_unread_inbound, ezt_added_at)
     VALUES ($1, 'Pat', true, now() - interval '9 days') RETURNING id`,
    [phone]
  );
  const leadId: number = rows[0].id;

  // Scored, so the queue counts them a responder, and expired, so only the
  // unread flag can keep them in it.
  await pool.query(
    `INSERT INTO conversations (lead_id, status, step, q1, score, tier, expires_at)
     VALUES ($1, 'expired', 2, '3', 25, 'LOW', now() - interval '2 days')`,
    [leadId]
  );
  return leadId;
}

async function isQueued(leadId: number): Promise<boolean> {
  const page = await listQueue({});
  return page.leads.some((l) => l.id === leadId);
}

async function flagOf(leadId: number): Promise<boolean | null> {
  const { rows } = await pool.query(`SELECT has_unread_inbound FROM leads WHERE id = $1`, [leadId]);
  return rows[0]?.has_unread_inbound ?? null;
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  console.log('\nan expired lead who texted back');
  {
    const lead = await makeExpiredLeadWithReply('+15550000101');

    check('starts in the queue', await isQueued(lead), true);

    const first = await markLeadRead(lead);
    check('marking read succeeds', first.ok && first.changed, true);
    check('the flag is cleared', await flagOf(lead), false);

    // The whole point: an expired conversation is closed, so with the flag gone
    // there is nothing left keeping the lead in the queue.
    check('the lead leaves the queue', await isQueued(lead), false);
  }

  console.log('\nmarking read twice');
  {
    const lead = await makeExpiredLeadWithReply('+15550000102');
    await markLeadRead(lead);

    const again = await markLeadRead(lead);
    check('succeeds', again.ok, true);
    check('reports it changed nothing', again.ok && again.changed, false);
  }

  console.log('\na lead with no unread reply');
  {
    const { rows } = await pool.query(
      `INSERT INTO leads (phone, has_unread_inbound) VALUES ('+15550000103', false) RETURNING id`
    );
    const result = await markLeadRead(rows[0].id);
    check('succeeds without changing anything', result.ok && result.changed, false);
  }

  console.log('\nan open conversation');
  {
    const { rows } = await pool.query(
      `INSERT INTO leads (phone, has_unread_inbound, ezt_added_at)
       VALUES ('+15550000104', true, now()) RETURNING id`
    );
    const lead: number = rows[0].id;
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, q1, score, tier)
       VALUES ($1, 'open', 2, '3', 25, 'LOW')`,
      [lead]
    );

    check('is queued before', await isQueued(lead), true);
    await markLeadRead(lead);
    // Still open, so it belongs in the queue on its own merits - the flag was
    // never what was holding it there.
    check('stays queued after being read', await isQueued(lead), true);
  }

  console.log('\na lead that does not exist');
  {
    const result = await markLeadRead(999999);
    check('reports not_found', result.ok === false && result.reason, 'not_found');
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
