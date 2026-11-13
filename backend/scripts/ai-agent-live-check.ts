/**
 * Proves migration 022 against a real Postgres - Phase 7, A08,
 * docs/AI-AGENT.md sections 4 and 9 - the relay's SQL on it (A10, A11), and
 * whether an answered call goes to her (A13), carrying out how her part ended
 * (A14), and the call backs she books (A15).
 *
 * Seri's columns on a call, the turns of her conversation, and the call backs
 * she books are kept by the database's own checks and triggers, which the
 * jest tests cannot see. This tries every one of them for real: what must be
 * allowed, and what must be refused.
 *
 * It writes rows, so it refuses to run against a database that holds any.
 * Run through scripts/live-checks.sh:
 *
 *   scripts/live-checks.sh ai-agent
 */
import { seriGreeting } from '../src/ai/answer';
import { endAiCall, recordedHandoff, saveTurn, startAiCall, whoIsThere } from '../src/ai/relay-store';
import { switchAiAgent } from '../src/ai/settings';
import { keepCallResult, transferContext } from '../src/db/auto-calls';
import { getLeadDetail } from '../src/db/lead-detail';
import { WORKED_SQL } from '../src/db/lead-state';
import { getTimeline } from '../src/db/timeline';
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

/** 'allowed', or the name of the check, trigger or rule that refused it. */
async function attempt(sql: string, values: unknown[] = []): Promise<string> {
  try {
    await pool.query(sql, values);
    return 'allowed';
  } catch (err) {
    const e = err as { constraint?: string; message: string };
    return e.constraint ?? e.message;
  }
}

async function refuseIfNotEmpty(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM leads)::int AS leads, (SELECT count(*) FROM users)::int AS users`
  );
  if (rows[0].leads > 0 || rows[0].users > 0) {
    console.error('Refusing to run: this database already holds rows. Use a scratch database.');
    process.exit(1);
  }
}

let phones = 0;
async function makeLead(): Promise<number> {
  phones++;
  const { rows } = await pool.query(`INSERT INTO leads (phone) VALUES ($1) RETURNING id`, [`+1555000${String(phones).padStart(4, '0')}`]);
  return rows[0].id;
}

async function makeCall(leadId: number, direction: 'automated' | 'outbound', agentId: number | null = null): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO calls (lead_id, agent_id, direction, twilio_call_sid) VALUES ($1, $2, $3, $4) RETURNING id`,
    [leadId, agentId, direction, `CA-check-${leadId}-${direction}`]
  );
  return rows[0].id;
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();
  const { rows: users } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ('maya@example.com', 'x', 'Maya', 'agent') RETURNING id`
  );
  const maya = users[0].id;

  console.log('\nthe switch');
  {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'ai_agent'`);
    check('starts off: every call gets the script', rows[0]?.value, 'off');
  }

  console.log('\nSeri\'s part of a call');
  {
    const lead = await makeLead();
    const call = await makeCall(lead, 'automated');
    const agentLead = await makeLead();
    const agentCall = await makeCall(agentLead, 'outbound', maya);
    const set = (id: number, sql: string, values: unknown[] = []) =>
      attempt(`UPDATE calls SET ${sql} WHERE id = $1`, [id, ...values]);

    check('a robot call never taken by Seri reads as before', (await pool.query(
      `SELECT ai_started_at, ai_knowledge_version, ai_ended_with FROM calls WHERE id = $1`, [call]
    )).rows[0], { ai_started_at: null, ai_knowledge_version: null, ai_ended_with: null });
    check('started without the knowledge version: refused', await set(call, `ai_started_at = now()`), 'calls_ai_started_with_version');
    check('ended before she started: refused', await set(call, `ai_ended_with = 'end_call'`), 'calls_ai_ended_after_start');
    check('started, with the version', await set(call, `ai_started_at = now(), ai_knowledge_version = $2`, ['approved-2026-11-11']), 'allowed');
    for (const action of ['transfer_to_agent', 'book_callback', 'send_link', 'opt_out', 'end_call', 'fallback']) {
      check(`ended with ${action}`, await set(call, `ai_ended_with = $2`, [action]), 'allowed');
    }
    check('ended with anything else: refused', await set(call, `ai_ended_with = 'maybe'`), 'calls_ai_ended_with_check');
    check('on an agent\'s own call: refused', await set(agentCall, `ai_started_at = now(), ai_knowledge_version = 'v'`), 'calls_ai_is_automated');
    check('her new result, callback_booked, on a robot call', await set(call, `script_result = 'callback_booked'`), 'allowed');
    check('every earlier result still allowed', await set(call, `script_result = 'not_placed'`), 'allowed');
    check('a result that is not one: refused', await set(call, `script_result = 'maybe'`), 'calls_script_result_check');
    check('a result on an agent\'s call: still refused', await set(agentCall, `script_result = 'callback_booked'`), 'calls_script_result_automated');
  }

  console.log('\nthe turns of her conversation');
  {
    const lead = await makeLead();
    const call = await makeCall(lead, 'automated');
    const turn = (who: string, text: string, latency: number | null = null) =>
      attempt(`INSERT INTO call_ai_turns (call_id, who, text, latency_ms) VALUES ($1, $2, $3, $4)`, [call, who, text, latency]);

    check('the lead', await turn('lead', 'Who is this?'), 'allowed');
    check('Seri, with how long she took to start', await turn('seri', 'This is Seri from eDrugstore.', 640), 'allowed');
    check('her action, and the relay\'s own note', [await turn('action', 'end_call'), await turn('system', 'fallback')], ['allowed', 'allowed']);
    check('anyone else: refused', await turn('agent', 'Hello'), 'call_ai_turns_who_check');
    check('a time to start on the lead\'s turn: refused', await turn('lead', 'Yes', 300), 'call_ai_turns_check');
    check('a negative time: refused', await turn('seri', 'Sure.', -1), 'call_ai_turns_latency_ms_check');
    check('kept in order', (await pool.query(`SELECT who FROM call_ai_turns WHERE call_id = $1 ORDER BY id`, [call])).rows.map((r) => r.who), [
      'lead',
      'seri',
      'action',
      'system',
    ]);
    check('a turn cannot be changed', await attempt(`UPDATE call_ai_turns SET text = 'x'`), 'call_ai_turns is add-only: rows cannot be changed or deleted');
    check('or deleted', await attempt(`DELETE FROM call_ai_turns`), 'call_ai_turns is add-only: rows cannot be changed or deleted');
  }

  console.log('\nthe call backs she books');
  {
    const lead = await makeLead();
    const call = await makeCall(lead, 'automated');
    const book = (agentId: number | null, reason: string, callId: number | null) =>
      attempt(
        `INSERT INTO callbacks (lead_id, agent_id, scheduled_at, reason, booked_by_call_id) VALUES ($1, $2, now() + interval '1 day', $3, $4)`,
        [lead, agentId, reason, callId]
      );

    check('hers, open to everyone: no agent, the call it was booked on', await book(null, 'ai_booked', call), 'allowed');
    // Another call: one call back per call she booked it on (023, A15).
    check('hers, owned by the lead\'s agent', await book(maya, 'ai_booked', await makeCall(await makeLead(), 'automated')), 'allowed');
    check('an agent\'s own with no agent: still refused', await book(null, 'booked', null), 'callbacks_agent_unless_ai');
    check('a missed call\'s with no agent: still refused', await book(null, 'missed_call', null), 'callbacks_agent_unless_ai');
    check('hers without the call it was booked on: refused', await book(null, 'ai_booked', null), 'callbacks_ai_names_its_call');
    check('an agent\'s own naming a call: refused', await book(maya, 'booked', call), 'callbacks_ai_names_its_call');
    check('an agent\'s own, as before', await book(maya, 'booked', null), 'allowed');
    check('any other reason: refused', await book(maya, 'robot', null), 'callbacks_reason_check');
  }

  console.log('\nthe relay taking a call (A10)');
  {
    const lead = await makeLead();
    await pool.query(`UPDATE leads SET first_name = 'John' WHERE id = $1`, [lead]);
    const call = await makeCall(lead, 'automated');
    const sid = `CA-check-${lead}-automated`;
    const start = (callId: number, callSid = sid) => startAiCall(pool, { callId, callSid, knowledgeVersion: 'approved-test' });
    const started = (callId: number) =>
      pool.query(`SELECT ai_started_at IS NOT NULL AS started, ai_knowledge_version AS version FROM calls WHERE id = $1`, [callId]).then((r) => r.rows[0]);
    const records = (callId: number) =>
      pool
        .query(`SELECT actor_id, lead_id, detail FROM activity_log WHERE action = 'ai_agent.started' AND (detail->>'callId')::int = $1`, [callId])
        .then((r) => r.rows);

    const { rows: phoneRows } = await pool.query(`SELECT phone FROM leads WHERE id = $1`, [lead]);
    check('started: the call, and the lead she is talking to', await start(call), {
      ok: true,
      call: { callId: call, leadId: lead, firstName: 'John', phone: phoneRows[0].phone },
    });
    check('the row marked, with the knowledge version', await started(call), { started: true, version: 'approved-test' });
    check('recorded, by the system, with the call', await records(call), [
      { actor_id: null, lead_id: lead, detail: { callId: call, knowledgeVersion: 'approved-test' } },
    ]);
    check('a second connection for the call: refused', await start(call), { ok: false, reason: 'already_started' });
    check('and recorded once', (await records(call)).length, 1);

    const other = await makeCall(await makeLead(), 'automated');
    check('another Twilio call naming this row: refused', await start(other, 'CA-someone-else'), { ok: false, reason: 'other_call' });
    check('and the row left alone', await started(other), { started: false, version: null });
    check('nothing recorded for a refusal', (await records(other)).length, 0);

    const agentLead = await makeLead();
    const agentCall = await makeCall(agentLead, 'outbound', maya);
    check('an agent\'s own call: refused', await start(agentCall, `CA-check-${agentLead}-outbound`), { ok: false, reason: 'not_automated' });
    check('no such call: refused', await start(999999), { ok: false, reason: 'no_such_call' });

    const endedLead = await makeLead();
    const ended = await makeCall(endedLead, 'automated');
    await pool.query(`UPDATE calls SET ended_at = now(), outcome = 'completed' WHERE id = $1`, [ended]);
    check('a call already over: refused', await start(ended, `CA-check-${endedLead}-automated`), { ok: false, reason: 'over' });
    const resultLead = await makeLead();
    const withResult = await makeCall(resultLead, 'automated');
    await pool.query(`UPDATE calls SET script_result = 'voicemail_left' WHERE id = $1`, [withResult]);
    check('a call the script has a result for: refused', await start(withResult, `CA-check-${resultLead}-automated`), {
      ok: false,
      reason: 'over',
    });

    const raceLead = await makeLead();
    const race = await makeCall(raceLead, 'automated');
    const both = await Promise.all([start(race, `CA-check-${raceLead}-automated`), start(race, `CA-check-${raceLead}-automated`)]);
    check('two connections at once: one starts her', both.filter((r) => r.ok).length, 1);
    check('the other refused as already hers', both.filter((r) => !r.ok).map((r) => (r as { reason: string }).reason), ['already_started']);
    check('recorded once', (await records(race)).length, 1);

    await saveTurn(pool, { callId: call, who: 'seri', text: 'Hi, is this John?' });
    await saveTurn(pool, { callId: call, who: 'lead', text: 'Who is this?' });
    await saveTurn(pool, { callId: call, who: 'seri', text: 'Thanks.', latencyMs: 12 });
    await saveTurn(pool, { callId: call, who: 'system', text: 'Cut off. Heard: "Thanks"' });
    check(
      'turns kept in the order said, the time only on hers',
      (await pool.query(`SELECT who, text, latency_ms FROM call_ai_turns WHERE call_id = $1 ORDER BY id`, [call])).rows,
      [
        { who: 'seri', text: 'Hi, is this John?', latency_ms: null },
        { who: 'lead', text: 'Who is this?', latency_ms: null },
        { who: 'seri', text: 'Thanks.', latency_ms: 12 },
        { who: 'system', text: 'Cut off. Heard: "Thanks"', latency_ms: null },
      ]
    );
    check(
      'a time on the lead\'s turn: refused by the database',
      await saveTurn(pool, { callId: call, who: 'lead', text: 'Yes', latencyMs: 5 }).then(
        () => 'allowed',
        (err: { constraint?: string }) => err.constraint ?? 'refused'
      ),
      'call_ai_turns_check'
    );
  }

  console.log('\nhow her part ended (A11)');
  {
    const lead = await makeLead();
    const call = await makeCall(lead, 'automated');
    await startAiCall(pool, { callId: call, callSid: `CA-check-${lead}-automated`, knowledgeVersion: 'approved-test' });
    const records = () =>
      pool
        .query(`SELECT actor_id, lead_id, detail FROM activity_log WHERE action = 'ai_agent.ended' AND (detail->>'callId')::int = $1`, [call])
        .then((r) => r.rows);

    check('recorded', await endAiCall(pool, call, { action: 'end_call', reason: 'wrong_person' }), true);
    check('on the call', (await pool.query(`SELECT ai_ended_with FROM calls WHERE id = $1`, [call])).rows[0].ai_ended_with, 'end_call');
    check('in the activity log, by the system, with the reason', await records(), [
      { actor_id: null, lead_id: lead, detail: { action: 'end_call', callId: call, reason: 'wrong_person' } },
    ]);
    check('once: a second end changes nothing', await endAiCall(pool, call, { action: 'opt_out' }), false);
    check('the first stands', (await pool.query(`SELECT ai_ended_with FROM calls WHERE id = $1`, [call])).rows[0].ai_ended_with, 'end_call');
    check('and is recorded once', (await records()).length, 1);

    const neverLead = await makeLead();
    const never = await makeCall(neverLead, 'automated');
    check('a call she never took: nothing recorded', await endAiCall(pool, never, { action: 'transfer_to_agent' }), false);

    const otherLead = await makeLead();
    const other = await makeCall(otherLead, 'automated');
    await startAiCall(pool, { callId: other, callSid: `CA-check-${otherLead}-automated`, knowledgeVersion: 'approved-test' });
    await endAiCall(pool, other, { action: 'transfer_to_agent' });
    check(
      'any other action: no reason in the record',
      (await pool.query(`SELECT detail FROM activity_log WHERE action = 'ai_agent.ended' AND (detail->>'callId')::int = $1`, [other])).rows[0].detail,
      { action: 'transfer_to_agent', callId: other }
    );

    console.log('\nher part failing: the fallback (A12)');
    const failLead = await makeLead();
    const failed = await makeCall(failLead, 'automated');
    await startAiCall(pool, { callId: failed, callSid: `CA-check-${failLead}-automated`, knowledgeVersion: 'approved-test' });
    check('recorded', await endAiCall(pool, failed, { action: 'fallback', why: 'model_slow' }), true);
    check('on the call as fallback - what the robot counts (A17)', (await pool.query(`SELECT ai_ended_with FROM calls WHERE id = $1`, [failed])).rows[0].ai_ended_with, 'fallback');
    check(
      'in the activity log, with why',
      (await pool.query(`SELECT detail FROM activity_log WHERE action = 'ai_agent.ended' AND (detail->>'callId')::int = $1`, [failed])).rows[0].detail,
      { why: 'model_slow', action: 'fallback', callId: failed }
    );

    const silentLead = await makeLead();
    const silent = await makeCall(silentLead, 'automated');
    await startAiCall(pool, { callId: silent, callSid: `CA-check-${silentLead}-automated`, knowledgeVersion: 'approved-test' });
    await endAiCall(pool, silent, { action: 'end_call', reason: 'no_response' });
    check(
      'the relay\'s own ending - silence - is end_call, with its reason',
      (await pool.query(`SELECT c.ai_ended_with, a.detail FROM calls c JOIN activity_log a ON a.action = 'ai_agent.ended' AND (a.detail->>'callId')::int = c.id WHERE c.id = $1`, [silent])).rows[0],
      { ai_ended_with: 'end_call', detail: { action: 'end_call', callId: silent, reason: 'no_response' } }
    );
  }

  console.log('\nwho is there, before each reply (A11)');
  {
    const lead = await makeLead();
    const call = await makeCall(lead, 'automated');
    await pool.query(`UPDATE users SET taking_calls = false, ringable_until = NULL`);
    check('nobody taking calls: nobody', await whoIsThere(pool, call), 'nobody');

    const { rows: added } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, taking_calls, ringable_until)
       VALUES ('ana@example.com', 'x', 'Ana', 'agent', true, now() + interval '2 minutes') RETURNING id`
    );
    const ana = added[0].id;
    check('someone taking calls, app open, not on a call: someone free', await whoIsThere(pool, call), 'free');

    const busyLead = await makeLead();
    await pool.query(
      `INSERT INTO calls (lead_id, agent_id, direction, twilio_call_sid, started_at) VALUES ($1, $2, 'outbound', 'CA-check-ana-busy', now())`,
      [busyLead, ana]
    );
    check('the same person on a call: someone coming - the hold line', await whoIsThere(pool, call), 'coming');

    await pool.query(`UPDATE users SET taking_calls = false WHERE id = $1`, [ana]);
    check('on a call with the switch off: nobody - never rung for a transfer', await whoIsThere(pool, call), 'nobody');
  }

  console.log('\nthe call goes to her (A13)');
  {
    const named = await makeLead();
    await pool.query(`UPDATE leads SET first_name = 'Dana' WHERE id = $1`, [named]);
    const call = await makeCall(named, 'automated');
    const nameless = await makeCall(await makeLead(), 'automated');

    await switchAiAgent(pool, 'off');
    check('switched off: the script', await seriGreeting(pool, call, 'sk-test'), null);
    await switchAiAgent(pool, 'on');
    check('switched on, with a key: her, greeting the lead by name', await seriGreeting(pool, call, 'sk-test'), 'Hi, is this Dana?');
    check('a lead with no first name: "Hi there!"', await seriGreeting(pool, nameless, 'sk-test'), 'Hi there!');
    check('switched on, no key: the script', await seriGreeting(pool, call, ''), null);
    await switchAiAgent(pool, 'off');
    check('switched off again: the script, at once', await seriGreeting(pool, call, 'sk-test'), null);
  }

  console.log('\nafter her part (A14)');
  {
    const lead = await makeLead();
    const call = await makeCall(lead, 'automated');
    const result = async () => (await pool.query(`SELECT script_result FROM calls WHERE id = $1`, [call])).rows[0].script_result;

    check('nothing she ended with yet: none recorded', await recordedHandoff(pool, call), null);
    await saveTurn(pool, { callId: call, who: 'action', text: JSON.stringify({ action: 'send_link' }) });
    await saveTurn(pool, { callId: call, who: 'action', text: JSON.stringify({ action: 'opt_out' }) });
    check('what she ended with: the last action kept', await recordedHandoff(pool, call), { action: 'opt_out' });
    const odd = await makeCall(await makeLead(), 'automated');
    await saveTurn(pool, { callId: odd, who: 'action', text: 'not json' });
    check('kept unreadable: a fallback, never a guess', await recordedHandoff(pool, odd), { action: 'fallback', why: 'unreadable_handoff' });

    check('her result saved, the call\'s lead', await keepCallResult({ callId: call, result: 'link_sent', blockNumber: false }), {
      saved: true,
      leadId: lead,
      takenByVerdict: false,
      callbackId: null,
    });
    check('on the call', await result(), 'link_sent');
    check('Twilio asking again: not saved again - the link texted once', await keepCallResult({ callId: call, result: 'link_sent', blockNumber: false }), {
      saved: false,
      leadId: lead,
      takenByVerdict: false,
      callbackId: null,
    });
    check('a later result never overwrites it', (await keepCallResult({ callId: call, result: 'not_interested', blockNumber: false }), await result()), 'link_sent');

    const stopLead = await makeLead();
    const stopCall = await makeCall(stopLead, 'automated');
    const { rows: phone } = await pool.query(`SELECT phone FROM leads WHERE id = $1`, [stopLead]);
    await keepCallResult({ callId: stopCall, result: 'opted_out', blockNumber: true });
    check(
      'a stop: opted_out, and the number blocked as a stop on the script blocks it',
      (await pool.query(`SELECT reason FROM dnc_list WHERE phone = $1 AND released_at IS NULL`, [phone[0].phone])).rows.map((r) => r.reason),
      ['call_opt_out']
    );
    check(
      'blocked once, said twice',
      (await keepCallResult({ callId: stopCall, result: 'opted_out', blockNumber: true }),
      (await pool.query(`SELECT count(*)::int AS n FROM dnc_list WHERE phone = $1`, [phone[0].phone])).rows[0].n),
      1
    );
    check('no result, for a lead who hung up: nothing saved', await keepCallResult({ callId: odd, result: null, blockNumber: false }), {
      saved: false,
      leadId: (await pool.query(`SELECT lead_id FROM calls WHERE id = $1`, [odd])).rows[0].lead_id,
      takenByVerdict: false,
      callbackId: null,
    });
    const maya = (await pool.query(`SELECT id FROM users WHERE email = 'maya@example.com'`)).rows[0].id;
    const agentCall = await makeCall(await makeLead(), 'outbound', maya);
    check('an agent\'s own call: not one of hers - nothing saved', await keepCallResult({ callId: agentCall, result: 'link_sent', blockNumber: false }), {
      saved: false,
      leadId: null,
      takenByVerdict: false,
      callbackId: null,
    });
    const vmLead = await makeLead();
    const vm = await makeCall(vmLead, 'automated');
    await pool.query(`UPDATE calls SET script_result = 'voicemail_left' WHERE id = $1`, [vm]);
    check('the voicemail message has the call: nothing kept', await keepCallResult({ callId: vm, result: 'opted_out', blockNumber: true }), {
      saved: false,
      leadId: vmLead,
      takenByVerdict: true,
      callbackId: null,
    });

    const { rows: first } = await pool.query(
      `SELECT s.id FROM call_steps s JOIN call_scripts sc ON sc.id = s.script_id WHERE sc.is_active ORDER BY s.position LIMIT 1`
    );
    const seriCall = await makeCall(await makeLead(), 'automated');
    const scriptCall = await makeCall(await makeLead(), 'automated');
    await pool.query(`UPDATE calls SET ai_started_at = now(), ai_knowledge_version = 'v' WHERE id = $1`, [seriCall]);
    check('her transfer rings as a yes to the offer, the script\'s first step', (await transferContext(seriCall))?.yesStepId, first[0].id);
    check('a script call with no answer yet: none, as before', (await transferContext(scriptCall))?.yesStepId, null);
  }

  console.log('\nthe call backs she books (A15)');
  {
    const maya = (await pool.query(`SELECT id FROM users WHERE email = 'maya@example.com'`)).rows[0].id;
    const at = new Date(Date.now() + 2 * 86_400_000);
    const book = (callId: number) =>
      keepCallResult({
        callId,
        result: 'callback_booked',
        blockNumber: false,
        callback: { at, note: 'Wants to order antibiotics', timeZone: 'America/New_York' },
      });
    const booking = async (leadId: number) =>
      (await pool.query(`SELECT agent_id, reason, note, scheduled_at, booked_by_call_id FROM callbacks WHERE lead_id = $1`, [leadId])).rows;
    const worked = async (leadId: number) =>
      (await pool.query(`SELECT ${WORKED_SQL} AS worked FROM leads l WHERE l.id = $1`, [leadId])).rows[0].worked;

    const open = await makeLead();
    const openCall = await makeCall(open, 'automated');
    const first = await book(openCall);
    check('booked with her result', [first.saved, first.callbackId !== null], [true, true]);
    check('nobody holds the lead: open to everyone - no agent', await booking(open), [
      { agent_id: null, reason: 'ai_booked', note: 'Wants to order antibiotics', scheduled_at: at, booked_by_call_id: openCall },
    ]);
    check(
      'recorded, the system\'s doing, with the call and the lead\'s zone - her words stay on the callback',
      (await pool.query(`SELECT actor_id, subject_user_id, detail FROM activity_log WHERE action = 'callback.booked' AND lead_id = $1`, [open])).rows,
      // jsonb writes a time with its offset, as every callback record does.
      [{ actor_id: null, subject_user_id: null, detail: { via: 'seri', callId: openCall, timeZone: 'America/New_York', callbackId: first.callbackId, scheduledAt: at.toISOString().replace('Z', '+00:00') } }]
    );
    check('Twilio asking again: booked once', [(await book(openCall)).callbackId, (await booking(open)).length], [null, 1]);
    check('her booking is no person\'s work: the lead is not worked', await worked(open), false);

    const held = await makeLead();
    await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [held, maya]);
    await book(await makeCall(held, 'automated'));
    check('the lead held: their own agent\'s', (await booking(held)).map((b) => b.agent_id), [maya]);

    const inactive = (await pool.query(
      `INSERT INTO users (email, password_hash, name, role, is_active) VALUES ('gone@example.com', 'x', 'Gone', 'agent', false) RETURNING id`
    )).rows[0].id;
    const stale = await makeLead();
    await pool.query(`UPDATE leads SET assigned_to = $2 WHERE id = $1`, [stale, inactive]);
    await book(await makeCall(stale, 'automated'));
    check('held by a deactivated account: open to everyone', (await booking(stale)).map((b) => b.agent_id), [null]);

    const detail = await getLeadDetail(open);
    check('on the lead\'s page: when, her line, nobody\'s yet', detail?.aiCallback, {
      at: at.toISOString(),
      note: 'Wants to order antibiotics',
      agentName: null,
    });
    check('and the held lead\'s, with its agent', (await getLeadDetail(held))?.aiCallback?.agentName, 'Maya');
    await pool.query(`UPDATE callbacks SET done_at = now() WHERE lead_id = $1`, [open]);
    check('done: no longer on the page', (await getLeadDetail(open))?.aiCallback, null);
    const entry = (await getTimeline(open))?.find((e) => e.kind === 'callback');
    check('on the timeline, with her line, no author', [entry?.author, entry?.detail.reason, entry?.detail.note], [null, 'ai_booked', 'Wants to order antibiotics']);

    check(
      'a note only on hers',
      await attempt(`INSERT INTO callbacks (lead_id, agent_id, scheduled_at, note) VALUES ($1, $2, now(), 'x')`, [held, maya]),
      'callbacks_note_is_ai'
    );
    check(
      'and one line at most',
      await attempt(
        `INSERT INTO callbacks (lead_id, scheduled_at, reason, booked_by_call_id, note) VALUES ($1, now(), 'ai_booked', $2, repeat('x', 201))`,
        [held, await makeCall(await makeLead(), 'automated')]
      ),
      'callbacks_note_length'
    );
    check(
      'one per call she booked it on',
      await attempt(`INSERT INTO callbacks (lead_id, scheduled_at, reason, booked_by_call_id) VALUES ($1, now(), 'ai_booked', $2)`, [open, openCall]),
      'callbacks_one_per_ai_call'
    );
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
