/**
 * Proves db/auto-calls.ts against a real Postgres - T12, docs/AUTO-CALLS.md.
 *
 * What a mock cannot show: that an automated call's row is written with no
 * agent and its `call.started` record, before anything rings; that every
 * refusal - unknown lead, blocked number, a second call, no script, a number
 * that is not one of ours - writes no row and leaves its record; that a
 * webhook can only ever be linked to the row it names and to one Twilio call;
 * that a call Twilio refused is ended once, as failed; that the end is saved
 * as every call's is; and that two placements racing for one lead place one
 * call. Getting those wrong rings a lead twice, rings a number we may not, or
 * loses the record of a call.
 *
 * It writes rows, so it refuses to run against a database that holds leads.
 * Run it with the others: scripts/live-checks.sh auto-calls
 */
import { failAutomatedCall, linkAutomatedCall, startAutomatedCall } from '../src/db/auto-calls';
import { finishCall, recordAnsweredBy } from '../src/db/calls';
import { pool } from '../src/db/pool';

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

async function makeLead(phone: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, ezt_added_at) VALUES ($1, 'Pat', now()) RETURNING id`,
    [phone]
  );
  return rows[0].id;
}

/** An object with its keys in order - Postgres keeps a JSON object's keys in its own order. */
function sortedKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

/** Every number may ring - the test numbers are tested on their own below. */
const ANY = () => true;

async function callRow(callId: number) {
  const { rows } = await pool.query(
    `SELECT direction, agent_id, twilio_call_sid AS sid, outcome, duration_sec AS duration,
            started_at IS NOT NULL AS started, ended_at IS NOT NULL AS ended
     FROM calls WHERE id = $1`,
    [callId]
  );
  return rows[0];
}

async function automatedCalls(leadId: number): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM calls WHERE lead_id = $1`, [leadId]);
  return rows[0].n;
}

/** The newest activity row for a lead, or for none. */
async function lastRecord(leadId: number | null) {
  const { rows } = await pool.query(
    `SELECT action, actor_id, detail FROM activity_log
     WHERE lead_id IS NOT DISTINCT FROM $1 ORDER BY id DESC LIMIT 1`,
    [leadId]
  );
  return rows[0];
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  console.log('\nplacing one');
  let callId = 0;
  const pat = await makeLead('+15550000501');
  {
    const started = await startAutomatedCall({ leadId: pat, mayRing: ANY });
    check('allowed, with the number to ring', started.ok && started.phone, '+15550000501');
    callId = started.ok ? started.callId : 0;
    check('its row: automated, nobody\'s, not yet at Twilio, not ended', await callRow(callId), {
      direction: 'automated',
      agent_id: null,
      sid: null,
      outcome: null,
      duration: null,
      started: true,
      ended: false,
    });
    const record = await lastRecord(pat);
    check('recorded as started by the system, naming the row', [record.action, record.actor_id, record.detail], [
      'call.started',
      null,
      { callId, direction: 'automated' },
    ]);
  }

  console.log('\nrefused - no row, and the refusal recorded');
  {
    const again = await startAutomatedCall({ leadId: pat, mayRing: ANY });
    check('a second call to the same lead', again, { ok: false, reason: 'already_called' });
    check('still one call', await automatedCalls(pat), 1);
    check('recorded, why', (await lastRecord(pat)).detail, { reason: 'already_called', direction: 'automated' });

    const blocked = await makeLead('+15550000502');
    await pool.query(`INSERT INTO dnc_list (phone, reason) VALUES ('+15550000502', 'sms_stop')`);
    check('a blocked number', await startAutomatedCall({ leadId: blocked, mayRing: ANY }), {
      ok: false,
      reason: 'blocked',
    });
    check('no row for it', await automatedCalls(blocked), 0);

    const released = await makeLead('+15550000503');
    await pool.query(
      `INSERT INTO dnc_list (phone, reason, released_at, released_reason) VALUES ('+15550000503', 'sms_stop', now(), 'sms_start')`
    );
    check('a block since released does not stop it', (await startAutomatedCall({ leadId: released, mayRing: ANY })).ok, true);

    const stranger = await makeLead('+15550000504');
    const asked: string[] = [];
    const notOurs = await startAutomatedCall({
      leadId: stranger,
      mayRing: (phone) => {
        asked.push(phone);
        return false;
      },
    });
    check('a number that is not one of ours, outside production', notOurs, { ok: false, reason: 'not_test_number' });
    check('the lead\'s own number is the one asked about', asked, ['+15550000504']);
    check('no row for it', await automatedCalls(stranger), 0);

    check('an unknown lead', await startAutomatedCall({ leadId: 999999, mayRing: ANY }), {
      ok: false,
      reason: 'not_found',
    });
    check(
      'recorded without a lead, its id kept',
      sortedKeys((await lastRecord(null)).detail),
      sortedKeys({ reason: 'not_found', direction: 'automated', leadId: 999999 })
    );

    const scriptless = await makeLead('+15550000505');
    await pool.query(`UPDATE call_scripts SET is_active = false`);
    check('no active script - nothing to say', await startAutomatedCall({ leadId: scriptless, mayRing: ANY }), {
      ok: false,
      reason: 'no_script',
    });
    await pool.query(`UPDATE call_scripts SET is_active = true WHERE key = 'antibiotics'`);
    check('no row for it', await automatedCalls(scriptless), 0);
  }

  console.log('\nlinking Twilio\'s call to the row');
  {
    check('the first webhook links it', await linkAutomatedCall(callId, 'CA-AUTO-1'), true);
    check('saved on the row', (await callRow(callId)).sid, 'CA-AUTO-1');
    check('the same call again: still this row', await linkAutomatedCall(callId, 'CA-AUTO-1'), true);
    check('another Twilio call naming this row: refused', await linkAutomatedCall(callId, 'CA-OTHER'), false);
    check('and the row keeps its own', (await callRow(callId)).sid, 'CA-AUTO-1');
    check('a row that does not exist', await linkAutomatedCall(999999, 'CA-AUTO-9'), false);

    const agent = (
      await pool.query(
        `INSERT INTO users (email, name, role, password_hash) VALUES ('ava@example.com', 'Ava', 'agent', 'x') RETURNING id`
      )
    ).rows[0].id;
    const agentsCall = (
      await pool.query(
        `INSERT INTO calls (lead_id, agent_id, twilio_call_sid, started_at) VALUES ($1, $2, NULL, now()) RETURNING id`,
        [pat, agent]
      )
    ).rows[0].id;
    check('an agent\'s call is never linked by an automated call\'s webhook', await linkAutomatedCall(agentsCall, 'CA-AUTO-2'), false);
  }

  console.log('\nhow it ended - saved as every call\'s end is');
  {
    const ended = await finishCall({ callSid: 'CA-AUTO-1', outcome: 'answered', durationSec: 31 });
    check('recorded, and never a missed call', ended, { recorded: true, missedLeadId: null });
    const row = await callRow(callId);
    check('answered, 31 seconds, ended', [row.outcome, row.duration, row.ended], ['answered', 31, true]);
    const record = await lastRecord(pat);
    check('its record says automated', [record.action, record.detail.direction, record.detail.outcome], [
      'call.ended',
      'automated',
      'answered',
    ]);
    check('a machine on the line makes it a voicemail', await recordAnsweredBy({ callSid: 'CA-AUTO-1', answeredBy: 'machine' }), true);
    check('outcome', (await callRow(callId)).outcome, 'voicemail');
  }

  console.log('\nTwilio refused it');
  {
    const lee = await makeLead('+15550000506');
    const started = await startAutomatedCall({ leadId: lee, mayRing: ANY });
    const refusedId = started.ok ? started.callId : 0;
    await failAutomatedCall(refusedId, { status: 400, code: 21211 });
    const row = await callRow(refusedId);
    check('ended as failed, no talk time', [row.outcome, row.duration, row.ended], ['failed', 0, true]);
    const record = await lastRecord(lee);
    check('recorded with Twilio\'s status and code', [record.action, sortedKeys(record.detail)], [
      'call.ended',
      sortedKeys({
        callId: refusedId,
        direction: 'automated',
        outcome: 'failed',
        reason: 'twilio_refused',
        twilioStatus: 400,
        twilioCode: 21211,
      }),
    ]);
    await failAutomatedCall(refusedId, { status: 400, code: 21211 });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM activity_log WHERE lead_id = $1 AND action = 'call.ended'`,
      [lee]
    );
    check('only once - a second failure changes nothing and records nothing', rows[0].n, 1);
    check('and the lead is never called again', (await startAutomatedCall({ leadId: lee, mayRing: ANY })).ok, false);
  }

  console.log('\ntwo placements racing for one lead');
  {
    const sam = await makeLead('+15550000507');
    const results = await Promise.all([
      startAutomatedCall({ leadId: sam, mayRing: ANY }),
      startAutomatedCall({ leadId: sam, mayRing: ANY }),
    ]);
    check(
      'one placed, the other refused as already called',
      results.map((r) => (r.ok ? 'placed' : r.reason)).sort(),
      ['already_called', 'placed']
    );
    check('one row', await automatedCalls(sam), 1);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
