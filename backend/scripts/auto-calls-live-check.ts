/**
 * Proves db/auto-calls.ts against a real Postgres - T12 and T13,
 * docs/AUTO-CALLS.md.
 *
 * What a mock cannot show: that an automated call's row is written with no
 * agent and its `call.started` record, before anything rings; that every
 * refusal - unknown lead, blocked number, a second call, no script, a number
 * that is not one of ours - writes no row and leaves its record; that a
 * webhook can only ever be linked to the row it names and to one Twilio call;
 * that a call Twilio refused is ended once, as failed; that the end is saved
 * as every call's is; that two placements racing for one lead place one
 * call; that an answer is kept once however often Twilio sends it, a result
 * is never overwritten, and a stop blocks the number once; and that a call's
 * end gives an unfinished script its result; and that a transfer goes to whoever
 * took it - the lead taken over from any holder, recorded - once, and never to
 * a second person or a deactivated one (T15a); and that a lead on hold keeps
 * its place in line, first on hold first, is seen waiting until it leaves, and
 * hanging up on hold is a missed transfer an agent calls back (T16). Getting
 * those wrong rings a lead
 * twice, rings a number we may not, calls someone who said stop, gives a lead to
 * the wrong person, or loses the record of a call or of what the lead said.
 *
 * It writes rows, so it refuses to run against a database that holds leads.
 * Run it with the others: scripts/live-checks.sh auto-calls
 */
import {
  anyoneOnHold,
  callsOnHold,
  failAutomatedCall,
  holdCall,
  holdState,
  keepAnswer,
  linkAutomatedCall,
  missTransfer,
  settleAutomatedCall,
  startAutomatedCall,
  takeTransfer,
  transferContext,
} from '../src/db/auto-calls';
import { finishCall, recordAnsweredBy } from '../src/db/calls';
import { startConversation } from '../src/db/flows';
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

async function scriptResult(callId: number): Promise<string | null> {
  const { rows } = await pool.query(`SELECT script_result FROM calls WHERE id = $1`, [callId]);
  return rows[0].script_result;
}

/** A placed call, linked to its Twilio call - as after `/auto/answer`. */
async function placedCall(phone: string, callSid: string): Promise<{ leadId: number; callId: number }> {
  const leadId = await makeLead(phone);
  const started = await startAutomatedCall({ leadId, mayRing: ANY });
  const callId = started.ok ? started.callId : 0;
  await linkAutomatedCall(callId, callSid);
  return { leadId, callId };
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
    check('and never answered', await scriptResult(refusedId), 'unanswered');
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

  const q1 = (await pool.query(`SELECT id, key FROM call_steps WHERE key = 'q1'`)).rows[0] as { id: number; key: string };

  console.log('\nkeeping an answer (T13)');
  {
    const { callId, leadId } = await placedCall('+15550000508', 'CA-ANS-1');
    const yes = {
      callId,
      step: q1,
      attempt: 1 as const,
      spoken: { heard: '  Yes please ', confidence: 0.91234, digits: null },
      record: { result: 'choice' as const, choiceKey: '1', choiceLabel: 'Yes' },
      result: 'transfer_missed' as const,
      blockNumber: false,
    };
    check('kept, naming the call\'s lead', await keepAnswer(yes), { kept: true, leadId });
    const { rows } = await pool.query(
      `SELECT step_key, attempt, heard, confidence::text, digits, result, choice_key, choice_label
       FROM call_answers WHERE call_id = $1`,
      [callId]
    );
    check('as heard, how sure, and what it meant', rows, [
      { step_key: 'q1', attempt: 1, heard: 'Yes please', confidence: '0.912', digits: null, result: 'choice', choice_key: '1', choice_label: 'Yes' },
    ]);
    check('the call\'s result saved', await scriptResult(callId), 'transfer_missed');

    check('the same request again keeps nothing new', await keepAnswer(yes), { kept: false, leadId });
    const { rows: count } = await pool.query(`SELECT count(*)::int AS n FROM call_answers WHERE call_id = $1`, [callId]);
    check('still one answer', count[0].n, 1);

    await keepAnswer({ ...yes, attempt: 2, record: { result: 'silence', choiceKey: null, choiceLabel: null }, result: 'no_response' });
    check('a result is never overwritten', await scriptResult(callId), 'transfer_missed');

    const { callId: quiet, leadId: quietLead } = await placedCall('+15550000509', 'CA-ANS-2');
    check('a hang-up with nothing said: nothing kept', await keepAnswer({ ...yes, callId: quiet, record: null, result: null }), {
      kept: false,
      leadId: quietLead,
    });
    const { rows: none } = await pool.query(`SELECT count(*)::int AS n FROM call_answers WHERE call_id = $1`, [quiet]);
    check('no answer row, no result', [none[0].n, await scriptResult(quiet)], [0, null]);

    const { callId: long } = await placedCall('+15550000510', 'CA-ANS-3');
    await keepAnswer({ ...yes, callId: long, spoken: { heard: 'a'.repeat(900) }, record: { result: 'unclear', choiceKey: null, choiceLabel: null }, result: null });
    const heard = (await pool.query(`SELECT length(heard) AS n, confidence FROM call_answers WHERE call_id = $1`, [long])).rows[0];
    check('a very long hearing is kept to 500 characters; no figure is kept as none', [heard.n, heard.confidence], [500, null]);

    check('an agent\'s call is not an automated call\'s to keep answers on', await keepAnswer({ ...yes, callId: 999999 }), {
      kept: false,
      leadId: null,
    });
  }

  console.log('\nstop - the number blocked, once (T13), and the text questions ended');
  {
    const { leadId, callId } = await placedCall('+15550000511', 'CA-STOP-1');
    // Still waiting on the first text's question, as most leads the robot calls are.
    await startConversation(pool, leadId, 'open');
    const stop = {
      callId,
      step: q1,
      attempt: 1 as const,
      spoken: { heard: 'stop calling me', confidence: 0.8 },
      record: { result: 'opt_out' as const, choiceKey: null, choiceLabel: null },
      result: 'opted_out' as const,
      blockNumber: true,
    };
    await keepAnswer(stop);
    const block = (await pool.query(`SELECT reason, released_at FROM dnc_list WHERE phone = '+15550000511'`)).rows[0];
    check('blocked, as said on the automated call', [block.reason, block.released_at], ['call_opt_out', null]);
    check('the call\'s result', await scriptResult(callId), 'opted_out');
    const conversations = async (id: number) =>
      (await pool.query(`SELECT status FROM conversations WHERE lead_id = $1 ORDER BY id`, [id])).rows.map((r) => r.status);
    check('the open text conversation ended - the same end state as a STOP text', await conversations(leadId), [
      'suppressed',
    ]);
    const record = await lastRecord(leadId);
    check('recorded as blocked by the system', [record.action, record.actor_id, record.detail.reason], [
      'dnc.blocked',
      null,
      'call_opt_out',
    ]);

    await keepAnswer(stop);
    const blocks = async (phone: string) =>
      (await pool.query(`SELECT count(*)::int AS n FROM activity_log WHERE action = 'dnc.blocked' AND detail->>'phone' = $1`, [phone]))
        .rows[0].n;
    check('the same request again does not block it again', await blocks('+15550000511'), 1);

    const { leadId: finishedLead, callId: finishedCall } = await placedCall('+15550000520', 'CA-STOP-3');
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, score, tier, completed_at) VALUES ($1, 'completed', 30, 60, 'WARM', now())`,
      [finishedLead]
    );
    await keepAnswer({ ...stop, callId: finishedCall });
    check('a conversation already finished keeps its status', await conversations(finishedLead), ['completed']);

    const { callId: already } = await placedCall('+15550000512', 'CA-STOP-2');
    await pool.query(`INSERT INTO dnc_list (phone, reason) VALUES ('+15550000512', 'sms_stop')`);
    await keepAnswer({ ...stop, callId: already });
    const kept = (await pool.query(`SELECT reason FROM dnc_list WHERE phone = '+15550000512'`)).rows[0];
    check('a number already blocked keeps its block and its reason', [kept.reason, await blocks('+15550000512')], ['sms_stop', 0]);
  }

  console.log('\nthe end of a call gives an unfinished script its result (T13)');
  {
    const { callId: answered } = await placedCall('+15550000513', 'CA-END-1');
    await finishCall({ callSid: 'CA-END-1', outcome: 'answered', durationSec: 9 });
    await settleAutomatedCall(answered);
    check('answered, script never finished: hung_up', await scriptResult(answered), 'hung_up');

    const { callId: rang } = await placedCall('+15550000514', 'CA-END-2');
    await finishCall({ callSid: 'CA-END-2', outcome: 'no_answer', durationSec: 0 });
    await settleAutomatedCall(rang);
    check('never answered: unanswered', await scriptResult(rang), 'unanswered');

    const { callId: finished } = await placedCall('+15550000515', 'CA-END-3');
    await keepAnswer({
      callId: finished,
      step: q1,
      attempt: 1,
      spoken: { digits: '2' },
      record: { result: 'choice', choiceKey: '2', choiceLabel: 'No' },
      result: 'not_interested',
      blockNumber: false,
    });
    await finishCall({ callSid: 'CA-END-3', outcome: 'answered', durationSec: 20 });
    await settleAutomatedCall(finished);
    check('a script that reached its own end keeps its result', await scriptResult(finished), 'not_interested');

    const { callId: going } = await placedCall('+15550000516', 'CA-END-4');
    await settleAutomatedCall(going);
    check('a call still going is left alone', await scriptResult(going), null);
  }

  console.log('\nthe transfer (T15a)');
  {
    const person = async (email: string, active = true) =>
      (
        await pool.query(
          `INSERT INTO users (email, name, role, password_hash, is_active) VALUES ($1, $2, 'agent', 'x', $3) RETURNING id`,
          [email, email.split('@')[0], active]
        )
      ).rows[0].id as number;
    const maya = await person('maya@example.com');
    const sam = await person('sam@example.com');
    const gone = await person('gone@example.com', false);
    const callOf = async (id: number) =>
      (await pool.query(`SELECT agent_id, script_result FROM calls WHERE id = $1`, [id])).rows[0];
    const holderOf = async (id: number) =>
      (await pool.query(`SELECT assigned_to FROM leads WHERE id = $1`, [id])).rows[0].assigned_to;
    const pickups = async (id: number) =>
      (await pool.query(`SELECT actor_id, detail FROM activity_log WHERE lead_id = $1 AND action = 'lead.picked_up' ORDER BY id`, [id])).rows;
    const transfers = async (id: number) =>
      (await pool.query(`SELECT actor_id, detail FROM activity_log WHERE lead_id = $1 AND action = 'call.transferred' ORDER BY id`, [id]))
        .rows.map((r) => [r.actor_id, sortedKeys(r.detail)]);

    const { leadId, callId } = await placedCall('+15550000521', 'CA-XFER-1');
    await pool.query(`UPDATE leads SET first_name = 'Priya', last_name = 'Sharma', assigned_to = $2, assigned_at = now() WHERE id = $1`, [leadId, sam]);
    check('what a ring says: the lead, who holds them - rung first if free (T15b) - and no verdict yet', await transferContext(callId), {
      lead: { id: leadId, name: 'Priya Sharma', phone: '+15550000521' },
      heldBy: sam,
      answeredBy: null,
    });

    check('Maya accepts: hers, taken over from Sam', await takeTransfer(callId, maya), { ok: true, leadId, tookOverFrom: sam });
    check('the call is hers, and transferred', await callOf(callId), { agent_id: maya, script_result: 'transferred' });
    check('the lead is hers', await holderOf(leadId), maya);
    check('recorded as picked up through the transfer, from Sam', (await pickups(leadId)).map((r) => [r.actor_id, sortedKeys(r.detail)]), [
      [maya, sortedKeys({ via: 'transfer', callId, tookOverFrom: sam })],
    ]);

    check('the transfer taken is its own record, by Maya, from Sam', await transfers(leadId), [
      [maya, sortedKeys({ callId, tookOverFrom: sam })],
    ]);

    check('the same request again: still hers, nothing new', await takeTransfer(callId, maya), { ok: true, leadId, tookOverFrom: null });
    check('one pick-up, one transfer', [(await pickups(leadId)).length, (await transfers(leadId)).length], [1, 1]);
    check('Sam cannot take a call Maya has', await takeTransfer(callId, sam), { ok: false, reason: 'taken' });
    check('still hers', [await callOf(callId), await holderOf(leadId)], [{ agent_id: maya, script_result: 'transferred' }, maya]);

    const { leadId: freeLead, callId: freeCall } = await placedCall('+15550000522', 'CA-XFER-2');
    check('a lead nobody held has nobody to ring first', (await transferContext(freeCall))?.heldBy, null);
    check('a lead nobody held: taken, from nobody', await takeTransfer(freeCall, sam), { ok: true, leadId: freeLead, tookOverFrom: null });
    check('recorded without a takeover', (await pickups(freeLead)).map((r) => sortedKeys(r.detail)), [
      sortedKeys({ via: 'transfer', callId: freeCall }),
    ]);

    // Her browser picked the lead up a moment before Twilio's request arrived -
    // the first real transfer, 2026-10-20 - or it was already hers.
    const { leadId: ownLead, callId: ownCall } = await placedCall('+15550000524', 'CA-XFER-4');
    await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [ownLead, maya]);
    check('already hers when the request came: taken', await takeTransfer(ownCall, maya), {
      ok: true,
      leadId: ownLead,
      tookOverFrom: null,
    });
    check('no second pick-up', (await pickups(ownLead)).length, 0);
    check('but the transfer is still recorded', await transfers(ownLead), [[maya, sortedKeys({ callId: ownCall })]]);

    const { leadId: lateLead, callId: lateCall } = await placedCall('+15550000523', 'CA-XFER-3');
    check('an account deactivated while it rang takes nothing', await takeTransfer(lateCall, gone), { ok: false, reason: 'inactive' });
    check('the call and the lead untouched', [await callOf(lateCall), await holderOf(lateLead)], [
      { agent_id: null, script_result: null },
      null,
    ]);
    check('a call that is not ours to transfer', await takeTransfer(999999, maya), { ok: false, reason: 'not_found' });

    await missTransfer(lateCall);
    check('nobody took it: transfer_missed', (await callOf(lateCall)).script_result, 'transfer_missed');
    await missTransfer(callId);
    check('a transfer someone took is never made missed', (await callOf(callId)).script_result, 'transferred');
  }

  console.log('\nthe hold line (T16)');
  {
    const first = await placedCall('+15550000531', 'CA-HOLD-1');
    const second = await placedCall('+15550000532', 'CA-HOLD-2');
    const resultOf = async (id: number) =>
      (await pool.query(`SELECT script_result FROM calls WHERE id = $1`, [id])).rows[0].script_result;

    check('nobody on hold to begin with', await anyoneOnHold(), false);
    check('on hold, the first time', await holdCall(first.callId), true);
    const record = await lastRecord(first.leadId);
    check('recorded with it, the system\'s doing', [record.action, record.actor_id, record.detail], [
      'call.held',
      null,
      { callId: first.callId },
    ]);
    check('again: nothing new, recorded once', await holdCall(first.callId), false);
    // The first went on hold a minute and a half before the second.
    await pool.query(`UPDATE calls SET held_at = held_at - interval '90 seconds' WHERE id = $1`, [first.callId]);
    await holdCall(second.callId);
    check('someone is on hold - the robot waits (T20)', await anyoneOnHold(), true);

    const [a, b] = [await holdState(first.callId), await holdState(second.callId)];
    check('first on hold, first in line', [a?.place, b?.place], [1, 2]);
    check('how long each has waited', [a!.waitedSeconds >= 90, b!.waitedSeconds < 30], [true, true]);
    check('the watcher sees both, first in line first', (await callsOnHold()).map((c) => [c.callId, c.callSid]), [
      [first.callId, 'CA-HOLD-1'],
      [second.callId, 'CA-HOLD-2'],
    ]);

    await missTransfer(first.callId);
    check('the first hears the busy line: no longer waiting', [await holdState(first.callId), await resultOf(first.callId)], [
      null,
      'transfer_missed',
    ]);
    check('and the second is next', (await holdState(second.callId))?.place, 1);

    await finishCall({ callSid: 'CA-HOLD-2', outcome: 'answered', durationSec: 140 });
    await settleAutomatedCall(second.callId);
    check('hung up on hold: a missed transfer, so an agent calls back - never "hung up"', await resultOf(second.callId), 'transfer_missed');
    check('nobody on hold now', [await anyoneOnHold(), await callsOnHold()], [false, []]);

    const settled = await placedCall('+15550000533', 'CA-HOLD-3');
    await missTransfer(settled.callId);
    check('a call with its result already cannot go on hold', await holdCall(settled.callId), false);
    const { rows: agentCall } = await pool.query(
      `INSERT INTO calls (lead_id, agent_id, twilio_call_sid, direction, started_at)
       VALUES ($1, (SELECT id FROM users LIMIT 1), 'CA-HOLD-4', 'outbound', now()) RETURNING id`,
      [settled.leadId]
    );
    let refused = 'accepted';
    try {
      await pool.query(`UPDATE calls SET held_at = now() WHERE id = $1`, [agentCall[0].id]);
    } catch (err) {
      refused = (err as { constraint?: string }).constraint ?? 'error';
    }
    check('only an automated call can be on hold', refused, 'calls_held_is_automated');
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
