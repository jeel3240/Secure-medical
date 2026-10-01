/**
 * Proves db/calls.ts against a real Postgres - Phase 4, TWILIO.md.
 *
 * The jest tests mock the database, so they cover the routes and Twilio's
 * signature and nothing else. Whether a call may be placed - the agent holds
 * the lead, the number is not blocked - and whether a retried webhook is safe
 * are decided in SQL, and only a real database shows that they hold.
 *
 * It writes rows, so it refuses to run against a database that holds any. Make
 * a scratch one:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE calls_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/calls_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/calls_check JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/calls-live-check.ts
 *
 * Re-running needs a fresh database: DROP and re-migrate.
 */
import { pool } from '../src/db/pool';
import { finishCall, startCall } from '../src/db/calls';
import { blockNumber, DNC_REASONS } from '../src/db/dnc';
import { listAdminLeads } from '../src/db/leads';
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
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM leads)::int AS leads,
            (SELECT count(*) FROM users)::int AS users`
  );
  if (rows[0].leads > 0 || rows[0].users > 0) {
    console.error('Refusing to run: this database already holds rows. Use a scratch database.');
    process.exit(1);
  }
}

async function makeUser(name: string, active = true): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, is_active)
     VALUES ($1, 'x', $2, 'agent', $3) RETURNING id`,
    [`${name.toLowerCase()}@example.com`, name, active]
  );
  return rows[0].id;
}

/** A lead that finished the questions, held by `holder` if given. */
async function makeLead(phone: string, name: string, holder: number | null): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, assigned_to, assigned_at)
     VALUES ($1, $2, $3, CASE WHEN $3::int IS NULL THEN NULL ELSE now() END) RETURNING id`,
    [phone, name, holder]
  );
  await pool.query(
    `INSERT INTO conversations (lead_id, status, step, q1, q2, q3, score, tier)
     VALUES ($1, 'completed', 3, '1', '1', '1', 90, 'HOT')`,
    [rows[0].id]
  );
  return rows[0].id;
}

const callRows = async (leadId: number) =>
  (
    await pool.query(
      `SELECT twilio_call_sid AS sid, agent_id, outcome, duration_sec,
              started_at IS NOT NULL AS started, ended_at IS NOT NULL AS ended
       FROM calls WHERE lead_id = $1 ORDER BY id`,
      [leadId]
    )
  ).rows;

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  const maya = await makeUser('Maya');
  const sam = await makeUser('Sam');
  const gone = await makeUser('Gone', false);

  console.log('\nplacing a call');
  {
    const lead = await makeLead('+15550000601', 'Held', maya);
    const res = await startCall({ callSid: 'CA-1', leadId: lead, agentId: maya });
    check('the agent holding the lead may call it', res, { ok: true, phone: '+15550000601' });
    check('and the call is recorded, started and unfinished', await callRows(lead), [
      { sid: 'CA-1', agent_id: maya, outcome: null, duration_sec: null, started: true, ended: false },
    ]);

    // Twilio retries a webhook that was slow to answer, with the same CallSid.
    const again = await startCall({ callSid: 'CA-1', leadId: lead, agentId: maya });
    check('a retry connects again', again.ok, true);
    check('without a second row', (await callRows(lead)).length, 1);
  }

  console.log('\nwho may not');
  {
    const lead = await makeLead('+15550000602', 'SamsLead', sam);
    check("another agent's lead", await startCall({ callSid: 'CA-2', leadId: lead, agentId: maya }), {
      ok: false,
      reason: 'not_holder',
    });

    const free = await makeLead('+15550000603', 'Free', null);
    check('a lead nobody has picked up', await startCall({ callSid: 'CA-3', leadId: free, agentId: maya }), {
      ok: false,
      reason: 'not_holder',
    });

    const stale = await makeLead('+15550000604', 'Stale', gone);
    check('a deactivated agent, even on a lead they still hold', await startCall({ callSid: 'CA-4', leadId: stale, agentId: gone }), {
      ok: false,
      reason: 'not_holder',
    });

    check('a lead that does not exist', await startCall({ callSid: 'CA-5', leadId: 999_999, agentId: maya }), {
      ok: false,
      reason: 'not_found',
    });

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM calls WHERE twilio_call_sid <> 'CA-1'`);
    check('and none of those left a row', rows[0].n, 0);
  }

  console.log('\nthe do-not-call list blocks calls as well as texts');
  {
    const lead = await makeLead('+15550000605', 'Blocked', maya);
    await blockNumber(pool, '+15550000605', DNC_REASONS.smsStop);
    check('a blocked number is refused', await startCall({ callSid: 'CA-6', leadId: lead, agentId: maya }), {
      ok: false,
      reason: 'blocked',
    });
    await pool.query(`UPDATE dnc_list SET released_at = now() WHERE phone = '+15550000605'`);
    check('and allowed again once the block is released', (await startCall({ callSid: 'CA-6', leadId: lead, agentId: maya })).ok, true);
  }

  console.log('\nhow it ended');
  {
    const lead = await makeLead('+15550000606', 'Ended', maya);
    await startCall({ callSid: 'CA-7', leadId: lead, agentId: maya });

    check('the result is saved', await finishCall({ callSid: 'CA-7', outcome: 'answered', durationSec: 134 }), true);
    check('with its talk time, and an end', await callRows(lead), [
      { sid: 'CA-7', agent_id: maya, outcome: 'answered', duration_sec: 134, started: true, ended: true },
    ]);

    check('a second report changes nothing', await finishCall({ callSid: 'CA-7', outcome: 'failed', durationSec: 0 }), false);
    check('the first outcome stands', (await callRows(lead))[0].outcome, 'answered');
    check('a report for a call we never started is ignored', await finishCall({ callSid: 'CA-nope', outcome: 'busy', durationSec: 0 }), false);
  }

  console.log('\nwhat a call shows up as');
  {
    const lead = await makeLead('+15550000607', 'Shown', maya);
    await startCall({ callSid: 'CA-8', leadId: lead, agentId: maya });
    await finishCall({ callSid: 'CA-8', outcome: 'no_answer', durationSec: 0 });

    const entry = (await getTimeline(lead))!.find((e) => e.kind === 'call');
    check('on the timeline, with who called and how it went', entry && { author: entry.author, detail: entry.detail }, {
      author: 'Maya',
      detail: { outcome: 'no_answer', durationSec: 0 },
    });

    // A lead that has been called has been worked, even once it is let go.
    await pool.query(`UPDATE leads SET assigned_to = NULL, assigned_at = NULL WHERE id = $1`, [lead]);
    const admin = await listAdminLeads({ pageSize: 200 });
    check('and its lead reads Working on Admin > Leads', admin.leads.find((l) => l.id === lead)?.status, 'working');
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
