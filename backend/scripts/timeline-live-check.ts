/**
 * Proves db/timeline.ts against a real Postgres.
 *
 * The jest tests mock the database, so they show status codes and nothing
 * about the timeline itself. Everything that matters here - the merge across
 * five tables, the ordering including ties, which outbound rows count as agent
 * messages, and the system events that have no table - can only be seen
 * against real rows.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE timeline_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/timeline_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/timeline_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/timeline-live-check.ts
 */
import { pool } from '../src/db/pool';
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
  const { rows } = await pool.query(`SELECT count(*)::int AS leads FROM leads`);
  if (rows[0].leads > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }
}

async function makeUser(name: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, 'x', $2, 'agent') RETURNING id`,
    [`${name.toLowerCase()}@example.com`, name]
  );
  return rows[0].id;
}

async function makeLead(phone: string, receivedAgo: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, source, ezt_added_at)
     VALUES ($1, 'Jordan', 'CORE-G-27', now() - interval '${receivedAgo}') RETURNING id`,
    [phone]
  );
  return rows[0].id;
}

const kinds = (entries: { kind: string }[]) => entries.map((e) => e.kind);
const events = (entries: { kind: string; detail: any }[]) =>
  entries.filter((e) => e.kind === 'system').map((e) => e.detail.event);

async function main(): Promise<void> {
  await refuseIfNotEmpty();
  const maya = await makeUser('Maya');

  console.log('\na full conversation');
  {
    const lead = await makeLead('+15550000301', '2 hours');
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, q1, q2, q3, score, tier)
       VALUES ($1, 'completed', 3, '3', '1', '1', 100, 'HOT')`,
      [lead]
    );
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, ezt_message_id, created_at)
       VALUES ($1, 'outbound', 'Question 1', 'm1', now() - interval '110 minutes')`,
      [lead]
    );
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, from_number, received_at, created_at)
       VALUES ($1, 'inbound', '3', '15550000301', now() - interval '100 minutes', now() - interval '100 minutes')`,
      [lead]
    );

    const t = (await getTimeline(lead))!;
    check('merges system and message rows', kinds(t), ['system', 'sms', 'inbound', 'system']);
    check('derives received and scored', events(t), ['lead_received', 'scored']);

    // Nothing records when a score was reached, so it is placed at the reply
    // that earned it. Those share a timestamp, and the reply must read first.
    const reply = t.findIndex((e) => e.kind === 'inbound');
    const scored = t.findIndex((e) => e.kind === 'system' && (e.detail as any).event === 'scored');
    check('the reply comes before the score it earned', reply < scored, true);
    check('the score carries its tier', (t[scored].detail as any).tier, 'HOT');
  }

  console.log('\nordering across every table');
  {
    const lead = await makeLead('+15550000302', '3 hours');
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, q1, score, tier)
       VALUES ($1, 'open', 2, '3', 25, 'LOW')`,
      [lead]
    );
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, from_number, received_at, created_at)
       VALUES ($1, 'inbound', '3', '15550000302', now() - interval '150 minutes', now() - interval '150 minutes')`,
      [lead]
    );
    await pool.query(
      `INSERT INTO calls (lead_id, agent_id, outcome, duration_sec, started_at)
       VALUES ($1, $2, 'no_answer', 34, now() - interval '120 minutes')`,
      [lead, maya]
    );
    await pool.query(
      `INSERT INTO notes (lead_id, agent_id, body, created_at)
       VALUES ($1, $2, 'Left a voicemail', now() - interval '110 minutes')`,
      [lead, maya]
    );
    await pool.query(
      `INSERT INTO callbacks (lead_id, agent_id, scheduled_at, created_at)
       VALUES ($1, $2, now() + interval '1 day', now() - interval '100 minutes')`,
      [lead, maya]
    );
    await pool.query(
      `INSERT INTO dispositions (lead_id, agent_id, value, created_at)
       VALUES ($1, $2, 'callback_set', now() - interval '90 minutes')`,
      [lead, maya]
    );

    const t = (await getTimeline(lead))!;
    check('every table appears, oldest first', kinds(t), [
      'system',
      'inbound',
      'system',
      'call',
      'note',
      'callback',
      'disposition',
    ]);

    const times = t.map((e) => Date.parse(e.at));
    check('timestamps never go backwards', times.every((v, i) => i === 0 || times[i - 1] <= v), true);
    check('agent entries name their author', t.find((e) => e.kind === 'note')?.author, 'Maya');
    check('inbound has no author', t.find((e) => e.kind === 'inbound')?.author, null);
    check(
      'a call carries its outcome and length',
      t.find((e) => e.kind === 'call')?.detail,
      { outcome: 'no_answer', durationSec: 34 }
    );
  }

  console.log('\nagent SMS versus automated');
  {
    const lead = await makeLead('+15550000303', '1 hour');
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, score, agent_took_over_at)
       VALUES ($1, 'open', 1, 10, now() - interval '30 minutes')`,
      [lead]
    );
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, ezt_message_id, created_at)
       VALUES ($1, 'outbound', 'Question 1', 'm2', now() - interval '50 minutes')`,
      [lead]
    );
    // sent_by set: an agent wrote this one.
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, ezt_message_id, sent_by, created_at)
       VALUES ($1, 'outbound', 'Hi, it is Maya', 'm3', $2, now() - interval '20 minutes')`,
      [lead, maya]
    );

    const t = (await getTimeline(lead))!;
    check('splits one table into two kinds', kinds(t).filter((k) => k.includes('sms')), ['sms', 'agent_sms']);
    check('the agent message names its author', t.find((e) => e.kind === 'agent_sms')?.author, 'Maya');
    check('the automated one does not', t.find((e) => e.kind === 'sms')?.author, null);
    check('the take-over is a system event', events(t).includes('agent_took_over'), true);
  }

  console.log('\nan expired conversation');
  {
    const lead = await makeLead('+15550000304', '10 days');
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, score, tier, expires_at)
       VALUES ($1, 'expired', 1, 10, 'LOW', now() - interval '3 days')`,
      [lead]
    );
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, from_number, received_at, created_at)
       VALUES ($1, 'inbound', 'what?', '15550000304', now() - interval '9 days', now() - interval '9 days')`,
      [lead]
    );

    check('shows the expiry', events((await getTimeline(lead))!).includes('conversation_expired'), true);
  }

  console.log('\na live conversation');
  {
    const lead = await makeLead('+15550000305', '1 hour');
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, score, expires_at)
       VALUES ($1, 'open', 1, 0, now() + interval '7 days')`,
      [lead]
    );

    // expires_at is set on every send, so an open conversation always has a
    // future one. It has not expired, and the timeline must not say it has.
    check('does not claim it expired', events((await getTimeline(lead))!), ['lead_received']);
  }

  console.log('\na lead with no history');
  {
    const lead = await makeLead('+15550000306', '5 minutes');
    const t = (await getTimeline(lead))!;
    check('still shows it arrived', events(t), ['lead_received']);
    check('and nothing else', t.length, 1);
  }

  console.log('\na lead that does not exist');
  check('is null, not an empty list', await getTimeline(999999), null);

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
