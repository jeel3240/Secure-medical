/**
 * Proves db/dispositions.ts against a real Postgres.
 *
 * What mocks cannot show: that the disposition and the dnc_list block commit
 * together, that blocking reuses the one row a number is allowed, that a
 * blocked lead actually leaves the queue, and that a block set by an agent
 * looks to everything downstream exactly like one set by a STOP reply.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE disp_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/disp_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/disp_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/dispositions-live-check.ts
 */
import { pool } from '../src/db/pool';
import { setDisposition } from '../src/db/dispositions';
import { blockNumber, DNC_REASONS, releaseNumber } from '../src/db/dnc';
import { listQueue } from '../src/db/queue';
import { getTimeline } from '../src/db/timeline';

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

async function makeUser(name: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'x', $2, 'agent') RETURNING id`,
    [`${name.toLowerCase()}@example.com`, name]
  );
  return rows[0].id;
}

/** A lead that answered, so it qualifies for the queue (score > 0). */
async function makeQueuedLead(phone: string, name: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, source) VALUES ($1, $2, 'API') RETURNING id`,
    [phone, name]
  );
  const id = rows[0].id;
  await pool.query(
    `INSERT INTO conversations (lead_id, status, step, score, tier)
     VALUES ($1, 'completed', 3, 100, 'HOT')`,
    [id]
  );
  return id;
}

const dncRow = async (phone: string) =>
  (
    await pool.query(
      `SELECT reason, released_at, released_reason FROM dnc_list WHERE phone = $1`,
      [phone]
    )
  ).rows[0] ?? null;

const inQueue = async (leadId: number) =>
  (await listQueue({})).leads.some((l: { id: number }) => l.id === leadId);

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  const maya = await makeUser('Maya');

  console.log('\nan ordinary disposition');
  {
    const lead = await makeQueuedLead('+15550000501', 'Ordinary');
    const res = await setDisposition(lead, maya, 'not_interested');

    check('is recorded', res.ok && res.disposition.value, 'not_interested');
    check('names the agent', res.ok && res.disposition.agentName, 'Maya');
    check('blocks nothing', res.ok && res.disposition.blockedNumber, false);
    check('writes no dnc row', await dncRow('+15550000501'), null);

    // Worth knowing: the queue does not read dispositions, so this lead is
    // still queued at full score. See AGENT-WORKSPACE.md, "What a disposition
    // does not do".
    check('and the lead stays in the queue', await inQueue(lead), true);
  }

  console.log('\nappend-only');
  {
    const lead = await makeQueuedLead('+15550000502', 'Repeat');
    await setDisposition(lead, maya, 'no_answer');
    await setDisposition(lead, maya, 'no_answer');
    await setDisposition(lead, maya, 'interested');

    const { rows } = await pool.query(
      `SELECT value FROM dispositions WHERE lead_id = $1 ORDER BY id`,
      [lead]
    );
    check('every one is kept', rows.map((r) => r.value), ['no_answer', 'no_answer', 'interested']);

    const timeline = await getTimeline(lead);
    const values = (timeline ?? [])
      .filter((e) => e.kind === 'disposition')
      .map((e) => e.detail.value);
    check('and the timeline shows the sequence', values, ['no_answer', 'no_answer', 'interested']);
  }

  console.log('\nthe DNC disposition');
  {
    const lead = await makeQueuedLead('+15550000503', 'Blocked');
    check('starts in the queue', await inQueue(lead), true);

    const res = await setDisposition(lead, maya, 'dnc');
    check('reports that it blocked the number', res.ok && res.disposition.blockedNumber, true);

    const row = await dncRow('+15550000503');
    check('writes a live dnc row', row?.released_at, null);
    // So the DNC screen can tell an agent's decision from a lead's own opt-out.
    check('recorded as the agent\'s decision', row?.reason, DNC_REASONS.agentDisposition);
    check('and the lead leaves the queue', await inQueue(lead), false);
  }

  console.log('\nthe same row a STOP writes');
  {
    const phone = '+15550000504';
    const lead = await makeQueuedLead(phone, 'Both');

    // Blocked by a STOP first, then by an agent: one number, one row.
    await blockNumber(pool, phone, DNC_REASONS.smsStop);
    await setDisposition(lead, maya, 'dnc');

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM dnc_list WHERE phone = $1`, [
      phone,
    ]);
    check('still one row for the number', rows[0].n, 1);
    check('carrying the newest reason', (await dncRow(phone))?.reason, DNC_REASONS.agentDisposition);

    // Jeel's decision, 2026-09-22: a START releases an agent's block too.
    const released = await releaseNumber(pool, phone);
    check('a START releases it', released, 1);
    check('and the lead returns to the queue', await inQueue(lead), true);

    const after = await dncRow(phone);
    check('the row is kept as the record', after?.released_reason, 'sms_start');
  }

  console.log('\nre-blocking after a release');
  {
    const phone = '+15550000505';
    const lead = await makeQueuedLead(phone, 'Again');

    await setDisposition(lead, maya, 'dnc');
    await releaseNumber(pool, phone);
    await setDisposition(lead, maya, 'dnc');

    const row = await dncRow(phone);
    check('the block is live again', row?.released_at, null);
    check('and the release columns are cleared', row?.released_reason, null);
    check('the lead is out of the queue', await inQueue(lead), false);
  }

  console.log('\nan unknown lead');
  {
    const res = await setDisposition(999999, maya, 'interested');
    check('is rejected', res.ok === false && res.reason, 'lead_not_found');

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM dispositions WHERE lead_id = 999999`);
    check('and nothing is written', rows[0].n, 0);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
