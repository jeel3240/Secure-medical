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
 * Re-running needs a fresh database: DROP and re-migrate - or
 * `scripts/live-checks.sh queue`. 55 checks as of 2026-10-06.
 */
import { pool } from '../src/db/pool';
import { startFlow } from './live-flow';
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
  /** Null: no conversation yet - the caller starts one through the real flow. */
  status: string | null; q1?: string | null; q2?: string | null; q3?: string | null;
  score: number; tier: string | null; unread?: boolean; assignedTo?: number | null;
}) {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, last_name, source, ezt_added_at, has_unread_inbound, assigned_to)
     VALUES ($1,$2,'Test',$3, now() - ($4 || ' minutes')::interval, $5, $6) RETURNING id`,
    [opts.phone, opts.first, opts.source, String(opts.ageMin), opts.unread ?? false, opts.assignedTo ?? null]
  );
  const id = rows[0].id as number;
  if (opts.status === null) return id;
  // Placed by hand: these cases are about the queue's rules, which read the
  // conversation's status and score. The answer columns are no longer read.
  await pool.query(
    `INSERT INTO conversations (lead_id, status, step, q1, q2, q3, score, tier, flow_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, (SELECT id FROM flows WHERE is_active))`,
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
  await lead({ phone: '+15550000002', first: 'Warm', source: 'CORE-G-31', ageMin: 60, status: 'open', q1: '1', score: 45, tier: 'WARM' });
  await lead({ phone: '+15550000003', first: 'Low', source: 'CORE-G-27', ageMin: 3000, status: 'review', score: 10, tier: 'LOW' });
  await lead({ phone: '+15550000004', first: 'Held', source: 'CORE-G-27', ageMin: 10, status: 'completed', q1: '1', q2: '1', q3: '1', score: 80, tier: 'HOT', assignedTo: michael });
  await lead({ phone: '+15550000005', first: 'Back', source: 'CORE-G-27', ageMin: 20, status: 'expired', q1: '1', score: 20, tier: 'LOW', unread: true });
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
  // Partway through the questions but being worked - these must stay in.
  await lead({ phone: '+15550000011', first: 'Busy', source: 'CORE-G-31', ageMin: 28, status: 'open', q1: '3', score: 25, tier: 'LOW', assignedTo: michael });
  const booked = await lead({ phone: '+15550000012', first: 'Booked', source: 'CORE-G-27', ageMin: 35, status: 'open', q1: '1', score: 15, tier: 'LOW' });
  await pool.query(`INSERT INTO callbacks (lead_id, agent_id, scheduled_at) VALUES ($1,$2, now() + interval '5 hours')`, [booked, michael]);
  const handover = await lead({ phone: '+15550000013', first: 'Handover', source: 'CORE-G-27', ageMin: 45, status: 'open', q1: '2', score: 20, tier: 'LOW', unread: true });
  await pool.query(`UPDATE conversations SET agent_took_over_at = now() - interval '30 minutes' WHERE lead_id = $1`, [handover]);

  const called = await lead({ phone: '+15550000008', first: 'Called', source: 'CORE-G-27', ageMin: 15, status: 'completed', q1: '2', q2: '2', q3: '2', score: 50, tier: 'WARM' });

  // history that must not multiply rows
  await pool.query(`INSERT INTO conversations (lead_id, status, step, score, tier) VALUES ($1,'expired',1,20,'LOW')`, [hot]);
  await pool.query(`UPDATE conversations SET created_at = now() - interval '2 days' WHERE lead_id = $1 AND status = 'expired'`, [hot]);
  await pool.query(`INSERT INTO calls (lead_id, agent_id, outcome) VALUES ($1,$2,'no_answer'),($1,$2,'no_answer')`, [called, michael]);
  await pool.query(`INSERT INTO callbacks (lead_id, agent_id, scheduled_at) VALUES ($1,$2, now() + interval '3 hours'),($1,$2, now() + interval '1 hour')`, [released, michael]);
  await pool.query(`INSERT INTO callbacks (lead_id, agent_id, scheduled_at, done_at) VALUES ($1,$2, now(), now())`, [stale, michael]);

  const all = await listQueue();
  check('order: score desc then freshest', all.leads.map((l) => l.firstName), ['Hot', 'Held', 'Released', 'Stale', 'Tie-newer', 'Tie-older', 'Called', 'Busy', 'Back', 'Handover', 'Booked', 'Low']);
  // Jeel, 2026-09-28: only leads that need a person. Warm answered one question
  // and is still open - not asked for a call yet, so not here.
  check('a lead partway through the questions is not in the queue', all.leads.some((l) => l.firstName === 'Warm'), false);
  check('same score: the fresher lead is on top', all.leads.filter((l) => l.score === 55).map((l) => l.firstName), ['Tie-newer', 'Tie-older']);
  check('excluded the rest', all.total, 12);
  check('tier counts', all.counts, { all: 12, HOT: 2, WARM: 5, LOW: 5 });
  check('sources', all.sources, ['CORE-G-27', 'CORE-G-31']);
  check('one row per lead despite two conversations', all.leads.filter((l) => l.id === hot).length, 1);
  check('newest conversation wins', all.leads.find((l) => l.id === hot)?.conversationStatus, 'completed');

  // Jeel, 2026-09-28: only In progress, Inbound reply and Needs review. A
  // callback or past calls keep a lead in the queue but show no status.
  const tags: Record<string, any> = Object.fromEntries(all.leads.map((l) => [l.firstName, l.tag]));
  check('tag: nothing to say', tags.Hot, null);
  check('tag: held by an agent, with their id', tags.Held, { kind: 'working', agentId: michael, agentName: 'Michael' });
  check('tag: stale claim by a deactivated agent is ignored', tags.Stale, null);
  // Callback was dropped from the queue on 2026-09-28 and restored the next day,
  // naming whose it is.
  check('tag: a booked callback names whose it is', (tags.Released as { kind?: string; agentName?: string } | null)?.kind === 'callback' && (tags.Released as { agentName?: string }).agentName === 'Michael', true);
  check('tag: unread reply', tags.Back, { kind: 'inbound_reply' });
  check('tag: unreadable replies need a human', tags.Low, { kind: 'needs_review' });
  check('tag: call attempts show no status', tags.Called, null);
  check('partway, but an agent holds it: stays, Working', tags.Busy, { kind: 'working', agentId: michael, agentName: 'Michael' });
  check('partway, but a callback is booked: stays, Callback', (tags.Booked as { kind?: string } | null)?.kind, 'callback');
  check('partway, taken over, lead replied: stays, Inbound reply', tags.Handover, { kind: 'inbound_reply' });

  const hotOnly = await listQueue({ tier: ['HOT'] });
  check('tier filter narrows the rows', hotOnly.leads.map((l) => l.firstName), ['Hot', 'Held']);
  check('tier filter does not change the pills', hotOnly.counts, { all: 12, HOT: 2, WARM: 5, LOW: 5 });
  check('tier filter changes the total', hotOnly.total, 2);

  const oneSource = await listQueue({ source: ['CORE-G-31'] });
  check('source filter narrows the rows', oneSource.leads.map((l) => l.firstName), ['Busy']);
  check('source filter leaves the dropdown whole', oneSource.sources, ['CORE-G-27', 'CORE-G-31']);
  check('source filter narrows the pills', oneSource.counts, { all: 1, LOW: 1 });

  const recent = await listQueue({ since: new Date(Date.now() - 25 * 60_000) });
  check('since keeps only fresh leads', recent.leads.map((l) => l.firstName), ['Hot', 'Held', 'Tie-newer', 'Called', 'Back']);

  check('search by name', (await listQueue({ q: 'busy' })).leads.map((l) => l.firstName), ['Busy']);
  check('search cannot find a lead that is not in the queue', (await listQueue({ q: 'warm' })).leads.length, 0);
  check('search by last name', (await listQueue({ q: 'Test' })).total, 12);
  check('search by formatted phone', (await listQueue({ q: '(555) 000-0011' })).leads.map((l) => l.firstName), ['Busy']);
  check('search by phone fragment', (await listQueue({ q: '0000003' })).leads.map((l) => l.firstName), ['Low']);
  check('search with no match', (await listQueue({ q: 'nobody' })).leads.length, 0);
  check("a typed % is text, not a wildcard", (await listQueue({ q: '%' })).leads.length, 0);
  check("a typed _ is text, not a wildcard", (await listQueue({ q: 'H_t' })).leads.length, 0);
  check("search does not break on a quote", (await listQueue({ q: "o'brien" })).leads.length, 0);

  const two = await listQueue({ limit: 2 });
  check('limit cuts the rows', two.leads.map((l) => l.firstName), ['Hot', 'Held']);
  check('limit does not hide the total', two.total, 12);
  check('limit is reported back', two.limit, 2);
  check('limit is clamped, never rejected', (await listQueue({ limit: 9999 })).limit, 500);

  const combined = await listQueue({ tier: ['HOT', 'WARM'], source: ['CORE-G-27'], q: 'e' });
  check('filters combine', combined.leads.map((l) => l.firstName), ['Hot', 'Held', 'Released', 'Stale', 'Tie-newer', 'Tie-older', 'Called']);

  // Never answered a question - score 0 - then texted after the conversation
  // ended. Flagged for a person, and until 2026-09-28 kept out by score > 0,
  // where nobody would ever see it.
  const wrote = await lead({ phone: '+15550000199', first: 'Wrote', source: 'CORE-G-27', ageMin: 9 * 1440, status: 'expired', score: 0, tier: null, unread: true });
  const withWrote = await listQueue({ limit: 500 });
  check('a lead with no score who texted us is in the queue', withWrote.leads.some((l) => l.id === wrote), true);

  // Picked up before answering anything - from Admin > Leads. It read Working
  // there but was missing from the queue until 2026-09-29.
  const pickedEarly = await lead({ phone: '+15550000198', first: 'PickedEarly', source: 'CORE-G-27', ageMin: 3, status: 'open', score: 0, tier: null });
  const holderId = (await pool.query(`SELECT id FROM users ORDER BY id LIMIT 1`)).rows[0].id;
  await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [pickedEarly, holderId]);
  const withEarly = await listQueue({ limit: 200 });
  check('a lead held before it answered is in the queue', withEarly.leads.some((l) => l.id === pickedEarly), true);
  check('as working', withEarly.leads.find((l) => l.id === pickedEarly)?.tag?.kind, 'working');
  await pool.query(`UPDATE leads SET assigned_to = NULL, assigned_at = NULL WHERE id = $1`, [pickedEarly]);
  check('and leaves once let go', (await listQueue({ limit: 200 })).leads.some((l) => l.id === pickedEarly), false);

  // "No" on question 1, through the real flow - docs/FLOWS.md.
  const offersOnly = await lead({ phone: '+15550000196', first: 'OffersOnly', source: 'CORE-G-27', ageMin: 4, status: null, score: 0, tier: null });
  await startFlow(offersOnly, ['2', '1']);
  const wantsRep = await lead({ phone: '+15550000195', first: 'WantsRep', source: 'CORE-G-27', ageMin: 4, status: null, score: 0, tier: null });
  await startFlow(wantsRep, ['2', 'learn more']);
  const finished = await lead({ phone: '+15550000194', first: 'Finished', source: 'CORE-G-27', ageMin: 4, status: null, score: 0, tier: null });
  await startFlow(finished, ['1', '2', '3']);
  const wantsNothing = await lead({ phone: '+15550000193', first: 'WantsNothing', source: 'CORE-G-27', ageMin: 4, status: null, score: 0, tier: null });
  await startFlow(wantsNothing, ['no', 'no']);
  const afterNo = await listQueue({ limit: 200 });
  const row = (id: number) => afterNo.leads.find((l) => l.id === id);
  check('a lead who asked for offers only is not in the queue: no call to make', row(offersOnly), undefined);
  check('nor is one who said no to the offers and to a rep: they asked for nothing', row(wantsNothing), undefined);
  check('one who asked to hear from a rep is, at its own low score', [row(wantsRep)?.score, row(wantsRep)?.tier], [10, 'LOW']);
  check('tagged, so an agent sees why it is there', row(wantsRep)?.tag, { kind: 'wants_call' });
  check('a row carries its answers, as many as the lead gave', row(wantsRep)?.answers, [
    { key: 'q1', heading: 'Requested info', label: 'No' },
    { key: 'q1-a', heading: 'Offers', label: 'Learn more' },
  ]);
  check('three for a lead who finished', row(finished)?.answers.map((a) => a.label), ['Yes', 'No', 'Order online']);
  check('"Order online" is WARM: called, after the HOT ones', [row(finished)?.score, row(finished)?.tier], [55, 'WARM']);
  await pool.query(`UPDATE leads SET has_unread_inbound = true WHERE id = $1`, [offersOnly]);
  check('an offers lead who texts us is still shown to a person', (await listQueue({ limit: 200 })).leads.find((l) => l.id === offersOnly)?.tag, { kind: 'inbound_reply' });
  await pool.query(`UPDATE leads SET has_unread_inbound = false WHERE id = $1`, [offersOnly]);

  // A pending callback names whose it is - 2026-09-29.
  const promised = await lead({ phone: '+15550000197', first: 'Promised', source: 'CORE-G-27', ageMin: 30, status: 'completed', score: 50, tier: 'WARM' });
  await pool.query(
    `INSERT INTO callbacks (lead_id, agent_id, scheduled_at) VALUES ($1, $2, now() + interval '2 hours'), ($1, $2, now() + interval '1 hour')`,
    [promised, holderId]
  );
  const promisedTag = (await listQueue({ limit: 200 })).leads.find((l) => l.id === promised)?.tag;
  check('a pending callback shows whose it is', promisedTag?.kind === 'callback' && promisedTag.agentId === holderId, true);
  check('and the soonest one', promisedTag?.at && Math.round((Date.parse(promisedTag.at) - Date.now()) / 60_000), 60);
  await pool.query(`UPDATE callbacks SET done_at = now() WHERE lead_id = $1`, [promised]);
  check('once done, nothing to say', (await listQueue({ limit: 200 })).leads.find((l) => l.id === promised)?.tag, null);
  check('as an inbound reply', withWrote.leads.find((l) => l.id === wrote)?.tag, { kind: 'inbound_reply' });

  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
