/**
 * Proves the Admin > Leads statuses in db/leads.ts against a real Postgres -
 * above all Working and Closed, added 2026-09-28, which are computed from five
 * tables and cannot be checked with mocks.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE leads_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/leads_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/leads_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/admin-leads-live-check.ts
 */
import { pool } from '../src/db/pool';
import { listAdminLeads } from '../src/db/leads';

let failures = 0;

/** JSON with object keys sorted, so a GROUP BY's row order cannot fail a check. */
const stable = (v: unknown) =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val
  );

function check(label: string, actual: unknown, expected: unknown): void {
  const a = stable(actual);
  const e = stable(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  }
}

let nextPhone = 600;

/** A lead with one conversation. */
async function lead(
  name: string,
  conversation: { status: string; q1?: string; q2?: string; q3?: string; score?: number } | null
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, source) VALUES ($1, $2, 'API') RETURNING id`,
    [`+15550000${nextPhone++}`, name]
  );
  const id = rows[0].id;
  if (conversation) {
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, q1, q2, q3, score, tier)
       VALUES ($1, $2, 1, $3, $4, $5, $6, 'HOT')`,
      [id, conversation.status, conversation.q1 ?? null, conversation.q2 ?? null, conversation.q3 ?? null, conversation.score ?? 0]
    );
  }
  return id;
}

const COMPLETED = { status: 'completed', q1: '3', q2: '1', q3: '1', score: 100 };

async function main(): Promise<void> {
  const { rows: existing } = await pool.query(`SELECT count(*)::int AS n FROM leads`);
  if (existing[0].n > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }

  const { rows: u } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ('maya@x.test', 'x', 'Maya', 'agent') RETURNING id`
  );
  const maya = u[0].id;
  const { rows: g } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, is_active) VALUES ('gone@x.test', 'x', 'Gone', 'agent', false) RETURNING id`
  );
  const gone = g[0].id;
  const disposition = (id: number, value: string, ago = 0) =>
    pool.query(
      `INSERT INTO dispositions (lead_id, agent_id, value, created_at) VALUES ($1, $2, $3, now() - ($4 || ' minutes')::interval)`,
      [id, maya, value, String(ago)]
    );

  // The SMS part, untouched by agents.
  await lead('Waiting', { status: 'open' });
  await lead('Midway', { status: 'open', q1: '2', score: 20 });
  await lead('Ready', COMPLETED);
  await lead('Unclear', { status: 'review', score: 10 });
  await lead('Quiet', { status: 'expired', q1: '1', score: 15 });
  const stopped = await lead('Stopped', COMPLETED);
  await pool.query(`INSERT INTO dnc_list (phone, reason) SELECT phone, 'sms_stop' FROM leads WHERE id = $1`, [stopped]);

  // Working: each kind of trace an agent leaves, on its own.
  const held = await lead('Held', COMPLETED);
  await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [held, maya]);
  const noted = await lead('Noted', COMPLETED);
  await pool.query(`INSERT INTO notes (lead_id, agent_id, body) VALUES ($1, $2, 'left a voicemail')`, [noted, maya]);
  const booked = await lead('Booked', COMPLETED);
  await pool.query(`INSERT INTO callbacks (lead_id, agent_id, scheduled_at) VALUES ($1, $2, now())`, [booked, maya]);
  const called = await lead('Called', COMPLETED);
  await pool.query(`INSERT INTO calls (lead_id, agent_id, outcome) VALUES ($1, $2, 'no_answer')`, [called, maya]);
  const texted = await lead('Texted', { status: 'open', q1: '1', score: 15 });
  await pool.query(
    `INSERT INTO messages (lead_id, direction, body, ezt_message_id, sent_by) VALUES ($1, 'outbound', 'Hi', 'agent-1', $2)`,
    [texted, maya]
  );
  const tried = await lead('Tried', COMPLETED);
  await disposition(tried, 'no_answer');
  const reviewedWorked = await lead('ReviewWorked', { status: 'review', score: 10 });
  await pool.query(`INSERT INTO notes (lead_id, agent_id, body) VALUES ($1, $2, 'read them')`, [reviewedWorked, maya]);

  // Not working: held by a deactivated agent, and only automated messages.
  const stale = await lead('Stale', COMPLETED);
  await pool.query(`UPDATE leads SET assigned_to = $2 WHERE id = $1`, [stale, gone]);
  const auto = await lead('Auto', COMPLETED);
  await pool.query(`INSERT INTO messages (lead_id, direction, body, ezt_message_id) VALUES ($1, 'outbound', 'Q1', 'auto-1')`, [auto]);

  // Closed, and the ways out of it.
  const sold = await lead('Sold', COMPLETED);
  await disposition(sold, 'no_answer', 30);
  await disposition(sold, 'sold', 5);
  const notInterested = await lead('NotInterested', COMPLETED);
  await disposition(notInterested, 'not_interested');
  const wrong = await lead('Wrong', COMPLETED);
  await disposition(wrong, 'wrong_number');
  const reopened = await lead('Reopened', COMPLETED);
  await disposition(reopened, 'sold', 30);
  await disposition(reopened, 'interested', 5);
  const wroteBack = await lead('WroteBack', COMPLETED);
  await disposition(wroteBack, 'sold');
  await pool.query(`UPDATE leads SET has_unread_inbound = true WHERE id = $1`, [wroteBack]);
  const soldThenBlocked = await lead('SoldThenBlocked', COMPLETED);
  await disposition(soldThenBlocked, 'sold');
  await pool.query(`INSERT INTO dnc_list (phone, reason) SELECT phone, 'sms_stop' FROM leads WHERE id = $1`, [soldThenBlocked]);

  const all = await listAdminLeads({ pageSize: 200 });
  const by = Object.fromEntries(all.leads.map((l) => [l.firstName, l]));
  const status = (name: string) => by[name]?.status;

  console.log('\nthe SMS part');
  check('no reply yet: awaiting_reply', status('Waiting'), 'awaiting_reply');
  check('partway: answering (was in_progress)', status('Midway'), 'answering');
  check('all three, nobody has touched it: ready (was completed)', status('Ready'), 'ready');
  check('unclear: needs_review', status('Unclear'), 'needs_review');
  check('went quiet: expired', status('Quiet'), 'expired');
  check('blocked: opted_out', status('Stopped'), 'opted_out');

  console.log('\nworking - any trace of an agent');
  check('held by an active agent', status('Held'), 'working');
  check('a note', status('Noted'), 'working');
  check('a callback', status('Booked'), 'working');
  check('a call', status('Called'), 'working');
  check('an agent\'s own SMS, even partway through the questions', status('Texted'), 'working');
  check('a try-again outcome', status('Tried'), 'working');
  check('outranks needs_review', status('ReviewWorked'), 'working');
  check('not a claim by a deactivated agent', status('Stale'), 'ready');
  check('not our automated messages', status('Auto'), 'ready');

  console.log('\nclosed');
  check('sold, after an earlier no-answer', status('Sold'), 'closed');
  check('carries the outcome', by.Sold?.outcome, 'sold');
  check('not interested', status('NotInterested'), 'closed');
  check('wrong number', status('Wrong'), 'closed');
  check('the newest outcome decides: sold, then interested, is working', status('Reopened'), 'working');
  check('and an open lead carries no outcome', by.Reopened?.outcome, null);
  check('a closed lead that texts us is working again', status('WroteBack'), 'working');
  check('opted_out still outranks closed', status('SoldThenBlocked'), 'opted_out');

  console.log('\ntabs');
  const closedTab = await listAdminLeads({ status: 'closed', pageSize: 200 });
  check('the closed tab lists exactly the closed leads', closedTab.leads.map((l) => l.firstName).sort(), ['NotInterested', 'Sold', 'Wrong']);
  check('the counts add up per status', all.counts, {
    all: 21,
    awaiting_reply: 1,
    answering: 1,
    ready: 3,
    working: 9,
    closed: 3,
    needs_review: 1,
    expired: 1,
    opted_out: 2,
  });

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
