/**
 * Proves migration 022 against a real Postgres - Phase 7, A08,
 * docs/AI-AGENT.md sections 4 and 9 - and the relay's SQL on it (A10).
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
import { saveTurn, startAiCall } from '../src/ai/relay-store';
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
    check('hers, owned by the lead\'s agent', await book(maya, 'ai_booked', call), 'allowed');
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

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
