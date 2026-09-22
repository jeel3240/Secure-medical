/**
 * Proves db/queue.ts against a real Postgres.
 *
 * The jest tests cover the tag rules and the route; they cannot cover the SQL,
 * which is where the queue's rules actually live - who is included, the order,
 * the counts. This seeds one lead per case and asserts what comes back.
 *
 * It writes rows, so it refuses to run against a database that holds any. Make
 * a scratch one:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE queue_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/queue_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/queue_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/queue-live-check.ts
 *
 * Re-running needs a fresh database: DROP and re-migrate. Last run 2026-09-22,
 * 36 checks, all passing.
 */
import { pool } from '../src/db/pool';
import { listQueue } from '../src/db/queue';

let failures = 0;
const stable = (v: unknown) =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val
  );

function check(label: string, actual: unknown, expected: unknown) {
  const a = stable(actual);
  const e = stable(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else {
    console.log(`ok   ${label}  ${a}`);
  }
}

async function lead(opts: {
  phone: string; first: string; source: string; ageMin: number;
  status: string; q1?: string | null; q2?: string | null; q3?: string | null;
  score: number; tier: string | null; unread?: boolean; assignedTo?: number | null;
}) {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, last_name, source, ezt_added_at, has_unread_inbound, assigned_to)
     VALUES ($1,$2,'Test',$3, now() - ($4 || ' minutes')::interval, $5, $6) RETURNING id`,
    [opts.phone, opts.first, opts.source, String(opts.ageMin), opts.unread ?? false, opts.assignedTo ?? null]
  );
  const id = rows[0].id as number;
  await pool.query(
    `INSERT INTO conversations (lead_id, status, step, q1, q2, q3, score, tier)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, opts.status, 1, opts.q1 ?? null, opts.q2 ?? null, opts.q3 ?? null, opts.score, opts.tier]
  );
  return id;
}

async function main() {
  const { rows: existing } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM leads`);
  if (existing[0].n > 0) {
    console.error(
      `Refusing to run: this database already holds ${existing[0].n} lead(s).\n` +
        `It seeds test rows - point DATABASE_URL at an empty scratch database.`
    );
    process.exit(1);
  }

  const { rows: u } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ('michael@x.test','x','Michael','agent') RETURNING id`
  );
  const michael = u[0].id as number;
  const { rows: u2 } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, is_active) VALUES ('gone@x.test','x','Gone','agent', false) RETURNING id`
  );
  const gone = u2[0].id as number;

  // --- included ---
  const hot = await lead({ phone: '+15550000001', first: 'Hot', source: 'CORE-G-27', ageMin: 5, status: 'completed', q1: '3', q2: '1', q3: '1', score: 90, tier: 'HOT' });
  const warm = await lead({ phone: '+15550000002', first: 'Warm', source: 'CORE-G-31', ageMin: 60, status: 'open', q1: '1', score: 45, tier: 'WARM' });
  const low = await lead({ phone: '+15550000003', first: 'Low', source: 'CORE-G-27', ageMin: 3000, status: 'review', score: 10, tier: 'LOW' });
  const held = await lead({ phone: '+15550000004', first: 'Held', source: 'CORE-G-27', ageMin: 10, status: 'completed', q1: '1', q2: '1', q3: '1', score: 80, tier: 'HOT', assignedTo: michael });
  const back = await lead({ phone: '+15550000005', first: 'Back', source: 'CORE-G-27', ageMin: 20, status: 'expired', q1: '1', score: 20, tier: 'LOW', unread: true });
  const released = await lead({ phone: '+15550000006', first: 'Released', source: 'CORE-G-27', ageMin: 30, status: 'completed', q1: '1', q2: '1', q3: '1', score: 70, tier: 'WARM' });
  await pool.query(`INSERT INTO dnc_list (phone, reason, released_at, released_reason) VALUES ('+15550000006','sms_stop', now(), 'sms_start')`);
  // held by a deactivated agent: the claim is stale, the lead must stay workable
  const stale = await lead({ phone: '+15550000007', first: 'Stale', source: 'CORE-G-27', ageMin: 40, status: 'completed', q1: '1', q2: '1', q3: '1', score: 60, tier: 'WARM', assignedTo: gone });

  // --- excluded ---
  await lead({ phone: '+15550000101', first: 'Silent', source: 'CORE-G-27', ageMin: 5, status: 'open', score: 0, tier: null });
  await lead({ phone: '+15550000102', first: 'Blocked', source: 'CORE-G-27', ageMin: 5, status: 'suppressed', q1: '1', score: 10, tier: 'LOW' });
  await pool.query(`INSERT INTO dnc_list (phone, reason) VALUES ('+15550000102','sms_stop')`);
  await lead({ phone: '+15550000103', first: 'Quiet', source: 'CORE-G-27', ageMin: 5, status: 'expired', q1: '1', score: 20, tier: 'LOW' });
  await lead({ phone: '+15550000104', first: 'Stopped', source: 'CORE-G-27', ageMin: 5, status: 'suppressed', q1: '1', score: 20, tier: 'LOW' });

  await lead({ phone: '+15550000009', first: 'Tie-older', source: 'CORE-G-27', ageMin: 120, status: 'completed', q1: '1', q2: '1', q3: '1', score: 55, tier: 'WARM' });
  await lead({ phone: '+15550000010', first: 'Tie-newer', source: 'CORE-G-27', ageMin: 2, status: 'completed', q1: '1', q2: '1', q3: '1', score: 55, tier: 'WARM' });
  const called = await lead({ phone: '+15550000008', first: 'Called', source: 'CORE-G-27', ageMin: 15, status: 'completed', q1: '2', q2: '2', q3: '2', score: 50, tier: 'WARM' });

  // history that must not multiply rows
  await pool.query(`INSERT INTO conversations (lead_id, status, step, score, tier) VALUES ($1,'expired',1,20,'LOW')`, [hot]);
  await pool.query(`UPDATE conversations SET created_at = now() - interval '2 days' WHERE lead_id = $1 AND status = 'expired'`, [hot]);
  await pool.query(`INSERT INTO calls (lead_id, agent_id, outcome) VALUES ($1,$2,'no_answer'),($1,$2,'no_answer')`, [called, michael]);
  await pool.query(`INSERT INTO callbacks (lead_id, agent_id, scheduled_at) VALUES ($1,$2, now() + interval '3 hours'),($1,$2, now() + interval '1 hour')`, [released, michael]);
  await pool.query(`INSERT INTO callbacks (lead_id, agent_id, scheduled_at, done_at) VALUES ($1,$2, now(), now())`, [stale, michael]);

  const all = await listQueue();
  check('order: score desc then freshest', all.leads.map((l) => l.firstName), ['Hot', 'Held', 'Released', 'Stale', 'Tie-newer', 'Tie-older', 'Called', 'Warm', 'Back', 'Low']);
  check('same score: the fresher lead is on top', all.leads.filter((l) => l.score === 55).map((l) => l.firstName), ['Tie-newer', 'Tie-older']);
  check('excluded the rest', all.total, 10);
  check('tier counts', all.counts, { all: 10, HOT: 2, WARM: 6, LOW: 2 });
  check('sources', all.sources, ['CORE-G-27', 'CORE-G-31']);
  check('one row per lead despite two conversations', all.leads.filter((l) => l.id === hot).length, 1);
  check('newest conversation wins', all.leads.find((l) => l.id === hot)?.conversationStatus, 'completed');

  const tags: Record<string, any> = Object.fromEntries(all.leads.map((l) => [l.firstName, l.tag]));
  check('tag: nothing yet', tags.Hot, { kind: 'new' });
  check('tag: held by an agent', tags.Held, { kind: 'in_progress', agentName: 'Michael' });
  check('tag: stale claim by a deactivated agent is ignored', tags.Stale, { kind: 'new' });
  check('tag: soonest undone callback', tags.Released?.kind, 'callback');
  check('tag: unread reply', tags.Back, { kind: 'inbound_reply' });
  check('tag: unreadable replies need a human', tags.Low, { kind: 'needs_review' });
  check('tag: two call attempts', tags.Called, { kind: 'attempted', attempts: 2 });
  check('tag: stalled after one answer', tags.Warm, { kind: 'stalled', step: 1 });

  const soonest = new Date(tags.Released?.callbackAt ?? 0).getTime() - Date.now();
  check('callback is the soonest, not the first', soonest < 2 * 3600_000, true);

  const hotOnly = await listQueue({ tier: ['HOT'] });
  check('tier filter narrows the rows', hotOnly.leads.map((l) => l.firstName), ['Hot', 'Held']);
  check('tier filter does not change the pills', hotOnly.counts, { all: 10, HOT: 2, WARM: 6, LOW: 2 });
  check('tier filter changes the total', hotOnly.total, 2);

  const oneSource = await listQueue({ source: ['CORE-G-31'] });
  check('source filter narrows the rows', oneSource.leads.map((l) => l.firstName), ['Warm']);
  check('source filter leaves the dropdown whole', oneSource.sources, ['CORE-G-27', 'CORE-G-31']);
  check('source filter narrows the pills', oneSource.counts, { all: 1, WARM: 1 });

  const recent = await listQueue({ since: new Date(Date.now() - 25 * 60_000) });
  check('since keeps only fresh leads', recent.leads.map((l) => l.firstName), ['Hot', 'Held', 'Tie-newer', 'Called', 'Back']);

  check('search by name', (await listQueue({ q: 'warm' })).leads.map((l) => l.firstName), ['Warm']);
  check('search by last name', (await listQueue({ q: 'Test' })).total, 10);
  check('search by formatted phone', (await listQueue({ q: '(555) 000-0002' })).leads.map((l) => l.firstName), ['Warm']);
  check('search by phone fragment', (await listQueue({ q: '0000003' })).leads.map((l) => l.firstName), ['Low']);
  check('search with no match', (await listQueue({ q: 'nobody' })).leads.length, 0);
  check("a typed % is text, not a wildcard", (await listQueue({ q: '%' })).leads.length, 0);
  check("a typed _ is text, not a wildcard", (await listQueue({ q: 'H_t' })).leads.length, 0);
  check("search does not break on a quote", (await listQueue({ q: "o'brien" })).leads.length, 0);

  const two = await listQueue({ limit: 2 });
  check('limit cuts the rows', two.leads.map((l) => l.firstName), ['Hot', 'Held']);
  check('limit does not hide the total', two.total, 10);
  check('limit is reported back', two.limit, 2);
  check('limit is clamped, never rejected', (await listQueue({ limit: 9999 })).limit, 500);

  const combined = await listQueue({ tier: ['HOT', 'WARM'], source: ['CORE-G-27'], q: 'e' });
  check('filters combine', combined.leads.map((l) => l.firstName), ['Hot', 'Held', 'Released', 'Stale', 'Tie-newer', 'Tie-older', 'Called']);

  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
