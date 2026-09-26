/**
 * Proves db/callbacks.ts against a real Postgres.
 *
 * The tab windows are date arithmetic - "the rest of today", "from tomorrow",
 * "past and not done" - and a mocked database says nothing about whether they
 * hold. Nor about whether marking a done callback done again rewrites when the
 * work happened.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE cb_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/cb_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/cb_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/callbacks-live-check.ts
 */
import { pool } from '../src/db/pool';
import { createCallback, listCallbacks, updateCallback } from '../src/db/callbacks';

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

async function makeLead(phone: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, source) VALUES ($1, 'Jordan', 'API') RETURNING id`,
    [phone]
  );
  return rows[0].id;
}

/** Minutes from now, so every case sits on the right side of "now". */
const inMinutes = (n: number) => new Date(Date.now() + n * 60_000);

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  const maya = await makeUser('Maya');
  const sam = await makeUser('Sam');
  const lead = await makeLead('+15550000401');

  console.log('\nthe tab windows');
  {
    // Placed relative to now rather than to a fixed clock, so the checks hold
    // whatever time of day they run - with one exception: within 30 minutes of
    // midnight the "today" case lands tomorrow and that check fails. Rerun it
    // at any other hour rather than reading it as a bug.
    const overdue = await createCallback(lead, maya, inMinutes(-90));
    const soon = await createCallback(lead, maya, inMinutes(30));
    const tomorrow = await createCallback(lead, maya, inMinutes(60 * 30));

    const ids = async (when: 'today' | 'upcoming' | 'overdue' | 'all') =>
      (await listCallbacks({ agentId: maya, when })).callbacks.map((c) => c.id);

    check('overdue holds the past one', await ids('overdue'), [
      overdue.ok ? overdue.callback.id : -1,
    ]);
    check('today holds the one still to come', await ids('today'), [soon.ok ? soon.callback.id : -1]);
    check('upcoming holds tomorrow', await ids('upcoming'), [
      tomorrow.ok ? tomorrow.callback.id : -1,
    ]);

    // A callback at 9am seen at 3pm is overdue, not "today" - showing it under
    // both would hide that it was missed.
    check('a missed one is not also today', (await ids('today')).length, 1);
    check('all holds every one', (await ids('all')).length, 3);

    const { counts } = await listCallbacks({ agentId: maya, when: 'today' });
    check('counts cover every tab', counts, { today: 1, upcoming: 1, overdue: 1, all: 3 });
  }

  console.log('\nanother agent');
  {
    await createCallback(lead, sam, inMinutes(30));
    const mine = await listCallbacks({ agentId: maya, when: 'all' });
    const theirs = await listCallbacks({ agentId: sam, when: 'all' });

    check('sees only their own', theirs.callbacks.length, 1);
    check("and not the other agent's", mine.callbacks.every((c) => c.agentId === maya), true);
  }

  console.log('\nmarking done');
  {
    const made = await createCallback(lead, maya, inMinutes(-10));
    const id = made.ok ? made.callback.id : -1;

    const done = await updateCallback(id, maya, false, { done: true });
    check('sets done_at', done.ok && done.callback.doneAt !== null, true);
    const first = done.ok ? done.callback.doneAt : null;

    await new Promise((r) => setTimeout(r, 20));
    const again = await updateCallback(id, maya, false, { done: true });
    // Overwriting would rewrite when the work actually happened.
    check('marking done twice keeps the first time', again.ok && again.callback.doneAt, first);

    const listed = await listCallbacks({ agentId: maya, when: 'overdue' });
    check('a done callback leaves overdue', listed.callbacks.some((c) => c.id === id), false);
  }

  console.log('\nrescheduling');
  {
    const made = await createCallback(lead, maya, inMinutes(-30));
    const id = made.ok ? made.callback.id : -1;

    const moved = await updateCallback(id, maya, false, { scheduledAt: inMinutes(60 * 30) });
    check('changes the time', moved.ok, true);

    const upcoming = await listCallbacks({ agentId: maya, when: 'upcoming' });
    check('and moves it between tabs', upcoming.callbacks.some((c) => c.id === id), true);
  }

  console.log('\nwhose callback it is');
  {
    const made = await createCallback(lead, maya, inMinutes(30));
    const id = made.ok ? made.callback.id : -1;

    const bySam = await updateCallback(id, sam, false, { done: true });
    check('an agent cannot change another', bySam.ok === false && bySam.reason, 'not_yours');
    check('and is told whose it is', bySam.ok === false && bySam.reason === 'not_yours' && bySam.ownerName, 'Maya');

    // How a callback left by someone off sick gets moved.
    const forced = await updateCallback(id, sam, true, { done: true });
    check('a superadmin can', forced.ok, true);
  }

  console.log('\nthe list row carries what the screen shows');
  {
    const other = await makeLead('+15550000402');
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, score, tier) VALUES ($1, 'completed', 3, 100, 'HOT')`,
      [other]
    );
    await pool.query(`INSERT INTO notes (lead_id, agent_id, body) VALUES ($1, $2, 'older note')`, [other, maya]);
    await pool.query(`INSERT INTO notes (lead_id, agent_id, body) VALUES ($1, $2, 'newest note')`, [other, maya]);
    await createCallback(other, sam, inMinutes(45));

    const row = (await listCallbacks({ agentId: sam, when: 'today' })).callbacks.find(
      (c) => c.leadId === other
    );
    check('the lead phone', row?.lead.phone, '+15550000402');
    check('the tier', row?.lead.tier, 'HOT');
    check('and the newest note', row?.latestNote, 'newest note');
  }

  console.log('\nbad input');
  {
    const noLead = await createCallback(999999, maya, inMinutes(30));
    check('an unknown lead is rejected', noLead.ok === false && noLead.reason, 'lead_not_found');

    const noAgent = await createCallback(lead, 999999, inMinutes(30));
    check('an unknown agent is rejected', noAgent.ok === false && noAgent.reason, 'agent_not_found');

    const missing = await updateCallback(999999, maya, false, { done: true });
    check('an unknown callback is rejected', missing.ok === false && missing.reason, 'not_found');
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
