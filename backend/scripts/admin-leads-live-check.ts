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
import { startFlow } from './live-flow';
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
    // Through the real flow: one "1" per answer given - Yes, Yes, I know which
    // antibiotic - so the lead has the rows a real one has. Then the status and
    // score the case is about.
    const answered = [conversation.q1, conversation.q2, conversation.q3].filter(Boolean).length;
    const conversationId = await startFlow(id, Array(answered).fill('1'));
    await pool.query(
      `UPDATE conversations
       SET status = $2, score = $3, tier = 'HOT',
           current_question_id = CASE WHEN $2 = 'open' THEN current_question_id END
       WHERE id = $1`,
      [conversationId, conversation.status, conversation.score ?? 0]
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

  // A send EZ Texting refused is not activity.
  const refused = await lead('Refused', { status: 'open' });
  await pool.query(
    `INSERT INTO messages (lead_id, direction, body, delivery_status) VALUES ($1, 'outbound', 'Q1', 'failed')`,
    [refused]
  );

  // Closed, and the ways out of it.
  const closed = await lead('Closed', COMPLETED);
  await disposition(closed, 'closed');
  const soldBefore = await lead('SoldBefore', COMPLETED); // retired value, still closes
  await disposition(soldBefore, 'sold');
  const reopened = await lead('Reopened', COMPLETED);
  await disposition(reopened, 'closed', 30);
  await pool.query(`INSERT INTO callbacks (lead_id, agent_id, scheduled_at) VALUES ($1, $2, now() + interval '1 day')`, [reopened, maya]);
  const wroteBack = await lead('WroteBack', COMPLETED);
  await disposition(wroteBack, 'closed');
  await pool.query(`UPDATE leads SET has_unread_inbound = true WHERE id = $1`, [wroteBack]);
  // Closed, texted, and picked up again: the reply is read, so without the
  // hold rule it read Closed while an agent was working it - 2026-09-29.
  const pickedAgain = await lead('PickedAgain', COMPLETED);
  await disposition(pickedAgain, 'closed');
  await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [pickedAgain, maya]);

  const closedThenBlocked = await lead('ClosedThenBlocked', COMPLETED);
  await disposition(closedThenBlocked, 'closed');
  await pool.query(`INSERT INTO dnc_list (phone, reason) SELECT phone, 'sms_stop' FROM leads WHERE id = $1`, [closedThenBlocked]);

  // "No" on question 1, then the two ways that ends - docs/FLOWS.md.
  const offersOnly = await lead('OffersOnly', null);
  await startFlow(offersOnly, ['2', '1']);
  const wantsRep = await lead('WantsRep', null);
  await startFlow(wantsRep, ['2', 'learn more']);
  const wantsNothing = await lead('WantsNothing', null);
  await startFlow(wantsNothing, ['no', 'no thanks']);
  // Said No, was asked about offers, and went quiet: stopped on a question that is not "Q4".
  const quietOnOffers = await lead('QuietOnOffers', null);
  const quietConversation = await startFlow(quietOnOffers, ['2']);
  await pool.query(`UPDATE conversations SET status = 'expired' WHERE id = $1`, [quietConversation]);

  const all = await listAdminLeads({ pageSize: 200 });
  const by = Object.fromEntries(all.leads.map((l) => [l.firstName, l]));
  const status = (name: string) => by[name]?.status;
  const step = (name: string) => by[name]?.step;

  // Step is the question the lead is on now - 2026-09-29. It read the highest
  // question answered, one behind: "Answering · Q1" while being asked Q2.
  console.log('\nstep');
  check('no reply yet: on Q1', step('Waiting'), 'Q1');
  check('answered Q1: on Q2', step('Midway'), 'Q2');
  check('answered all three: done', step('Ready'), 'done');
  check('went quiet after Q1: stopped at Q2', step('Quiet'), 'Q2');
  check('unclear replies on Q1: stuck at Q1', step('Unclear'), 'Q1');
  // The offers question sits fourth, and is the second thing this lead was asked.
  check('said No, then went quiet on the offers question: "Offers", not "Q4"', step('QuietOnOffers'), 'Offers');

  console.log('\nthe SMS part');
  check('no reply yet: awaiting_reply', status('Waiting'), 'awaiting_reply');
  check('partway: answering (was in_progress)', status('Midway'), 'answering');
  check('all three, nobody has touched it: ready (was completed)', status('Ready'), 'ready');
  check('unclear: needs_review', status('Unclear'), 'needs_review');
  check('asked for offers only: offers, not ready - there is no call to make', status('OffersOnly'), 'offers');
  check('asked to hear from a rep: ready for an agent', status('WantsRep'), 'ready');
  check('said no to both: declined - not ready, nobody is to call them', status('WantsNothing'), 'declined');
  check('went quiet: expired', status('Quiet'), 'expired');
  check('blocked: opted_out', status('Stopped'), 'opted_out');

  console.log('\nworking - any trace of an agent');
  check('held by an active agent', status('Held'), 'working');
  check('a note', status('Noted'), 'working');
  check('a callback', status('Booked'), 'working');
  check('a call', status('Called'), 'working');
  check('an agent\'s own SMS, even partway through the questions', status('Texted'), 'working');
  check('an old try-again outcome (retired no_answer)', status('Tried'), 'working');
  check('outranks needs_review', status('ReviewWorked'), 'working');
  check('not a claim by a deactivated agent', status('Stale'), 'ready');
  check('not our automated messages', status('Auto'), 'ready');

  console.log('\na refused send');
  check('is not the last activity', by.Refused?.lastActivityAt, null);
  check('and the lead is still awaiting a reply', status('Refused'), 'awaiting_reply');

  console.log('\nclosed');
  check('pressed Closed', status('Closed'), 'closed');
  check('a lead closed under a retired value stays closed', status('SoldBefore'), 'closed');
  check('a callback booked after closing makes it working again', status('Reopened'), 'working');
  check('a closed lead that texts us is working again', status('WroteBack'), 'working');
  check('a closed lead an agent picked up again is working', status('PickedAgain'), 'working');
  check('opted_out still outranks closed', status('ClosedThenBlocked'), 'opted_out');

  console.log('\ntabs');
  const closedTab = await listAdminLeads({ status: 'closed', pageSize: 200 });
  check('the closed tab lists exactly the closed leads', closedTab.leads.map((l) => l.firstName).sort(), ['Closed', 'SoldBefore']);
  check('the counts add up per status', all.counts, {
    all: 26,
    awaiting_reply: 2,
    answering: 1,
    offers: 1,
    declined: 1,
    ready: 4,
    working: 10,
    closed: 2,
    needs_review: 1,
    expired: 2,
    opted_out: 2,
  });
  // The total is read from those counts, not counted again.
  check('the total is the chosen tab\'s count', [closedTab.total, all.total], [2, 26]);
  const second = await listAdminLeads({ pageSize: 10, page: 2 });
  check('a later page carries on in the same order, newest first', [second.leads.length, second.page, second.total], [10, 2, 26]);
  const firstIds = (await listAdminLeads({ pageSize: 10 })).leads.map((l) => l.id);
  check('and repeats nothing from the first', second.leads.some((l) => firstIds.includes(l.id)), false);

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
