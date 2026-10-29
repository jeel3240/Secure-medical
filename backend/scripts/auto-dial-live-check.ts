/**
 * Proves the robot's dialling against a real Postgres - T20, docs/AUTO-CALLS.md
 * "When a lead is called" and "Traffic": db/auto-dial.ts, with the worker's
 * look (`worker/auto-calls.ts`) run on it.
 *
 * What a mock cannot show: which leads the SQL picks - the hour's wait, a
 * reply, a call from them, held, worked, Closed, blocked, already called,
 * arrived before automated calls were switched on, the test numbers - and in
 * what order; that a lead whose hour ended overnight is first at 11am; that
 * the room counts the people free and the robot's calls still going, and is
 * nothing while a lead waits on hold; that two workers never dial at once;
 * and that a call that never reached Twilio is closed. And the leads already
 * waiting at the switch-on: called only once included, after the new leads,
 * and only for that switch-on. Getting those wrong calls a lead who already
 * replied, calls the backlog unasked, or rings more leads than anyone can
 * take.
 *
 * It writes rows, so it refuses to run against a database that holds leads.
 * Run it with the others: scripts/live-checks.sh auto-dial
 */
import { DEFAULT_CALL_HOURS, type Waiting } from '../src/core/auto-dial';
import { startAutomatedCall, holdCall, linkAutomatedCall } from '../src/db/auto-calls';
import {
  autoCallsSince,
  autoCallsState,
  closeUnplacedCalls,
  dialRoom,
  leadsToCall,
  recordAutoCallsSwitch,
  setWaitingIncluded,
  stillDue,
  waitingIncluded,
  withDialLock,
} from '../src/db/auto-dial';
import { startConversation } from '../src/db/flows';
import { pool } from '../src/db/pool';
import { dialDueLeads, type DialDeps } from '../src/worker/auto-calls';

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

const minutes = (n: number) => n * 60_000;
// Monday 2026-10-26, noon in Arizona (UTC-7, all year).
const NOW = new Date('2026-10-26T19:00:00Z');
const SINCE = new Date('2026-10-20T00:00:00Z');
const ARRIVED = new Date('2026-10-26T15:00:00Z');

let phones = 0;
/** A lead whose first text went out at `sent` (null: never), arrived at `arrived`. */
async function lead(opts: { sent: Date | null; arrived?: Date; status?: string; phone?: string }): Promise<number> {
  const phone = opts.phone ?? `+1555000${String(1000 + ++phones)}`;
  const arrived = opts.arrived ?? ARRIVED;
  const id = (
    await pool.query(`INSERT INTO leads (phone, first_name, created_at, ezt_added_at) VALUES ($1, 'Pat', $2, $2) RETURNING id`, [
      phone,
      arrived,
    ])
  ).rows[0].id as number;
  await startConversation(pool, id, 'open');
  await pool.query(
    `UPDATE conversations SET question_sent_at = $2, expires_at = $2::timestamptz + interval '7 days', status = $3 WHERE lead_id = $1`,
    [id, opts.sent, opts.status ?? 'open']
  );
  return id;
}

async function person(email: string, free: boolean): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, role, password_hash, taking_calls, ringable_until)
     VALUES ($1, $1, 'agent', 'x', $2, CASE WHEN $2 THEN now() + interval '2 minutes' END) RETURNING id`,
    [email, free]
  );
  return rows[0].id;
}

const due = (opts: Partial<{ now: Date; since: Date; only: string[] | null; limit: number; waiting: Waiting }> = {}) =>
  leadsToCall({ now: NOW, since: SINCE, waitMinutes: 60, only: null, limit: 100, ...opts });

async function main(): Promise<void> {
  await refuseIfNotEmpty();
  const maya = await person('maya@example.com', false);

  console.log('\nwhen automated calls were switched on - each time afresh');
  {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
    const first = await autoCallsSince();
    check('missing: written now', Math.abs(Date.now() - first.getTime()) < 60_000, true);
    await pause();
    check('read again: the same', (await autoCallsSince()).toISOString(), first.toISOString());

    const switches = async () =>
      (
        await pool.query(
          `SELECT detail->>'since' AS since, detail->>'previousSince' AS previous FROM activity_log WHERE action = 'auto_calls.switched_on' ORDER BY id`
        )
      ).rows;
    await pause();
    await recordAutoCallsSwitch(true);
    const on = await autoCallsSince();
    check('the worker starts with them on, never on before: a fresh start', on.getTime() > first.getTime(), true);
    check('recorded, with the time it replaced', await switches(), [{ since: on.toISOString(), previous: first.toISOString() }]);
    await pause();
    await recordAutoCallsSwitch(true);
    check('restarted while on: nothing changes', [(await autoCallsSince()).toISOString(), (await switches()).length], [on.toISOString(), 1]);
    await recordAutoCallsSwitch(false);
    check('switched off: the start is kept', (await autoCallsSince()).toISOString(), on.toISOString());
    await pause();
    await recordAutoCallsSwitch(true);
    const again = await autoCallsSince();
    check('on again: afresh - leads that came while off are never called', again.getTime() > on.getTime(), true);
    check('each switch-on recorded', (await switches()).length, 2);

    await pool.query(`UPDATE settings SET value = 'yesterday' WHERE key = 'auto_calls_since'`);
    let refused = 'accepted';
    try {
      await autoCallsSince();
    } catch (err) {
      refused = (err as Error).message;
    }
    check('a value that is not a time: an error, never a guess', refused, 'settings.auto_calls_since is not a time: yesterday');
    await pool.query(`UPDATE settings SET value = $1 WHERE key = 'auto_calls_since'`, [again.toISOString()]);
  }

  console.log('\nwho is picked');
  {
    const ready = await lead({ sent: new Date(NOW.getTime() - minutes(61)) });
    check('first text an hour ago, no reply, nobody\'s: picked', await due(), [ready]);

    const notYet = await lead({ sent: new Date(NOW.getTime() - minutes(59)) });
    const neverTexted = await lead({ sent: null });
    const before = await lead({ sent: new Date(NOW.getTime() - minutes(90)), arrived: new Date('2026-10-19T12:00:00Z') });
    const sent = new Date(NOW.getTime() - minutes(90));
    const texted = await lead({ sent });
    await pool.query(`INSERT INTO messages (lead_id, direction, body) VALUES ($1, 'inbound', 'who is this')`, [texted]);
    const rang = await lead({ sent });
    await pool.query(
      `INSERT INTO calls (lead_id, twilio_call_sid, direction, started_at, outcome, duration_sec, ended_at) VALUES ($1, 'IN-1', 'inbound', now(), 'missed', 0, now())`,
      [rang]
    );
    const held = await lead({ sent });
    await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [held, maya]);
    const noted = await lead({ sent });
    await pool.query(`INSERT INTO notes (lead_id, agent_id, body) VALUES ($1, $2, 'spoke to them')`, [noted, maya]);
    const closed = await lead({ sent });
    await pool.query(`INSERT INTO dispositions (lead_id, agent_id, value) VALUES ($1, $2, 'closed')`, [closed, maya]);
    const blocked = await lead({ sent });
    await pool.query(`INSERT INTO dnc_list (phone, reason) SELECT phone, 'sms_stop' FROM leads WHERE id = $1`, [blocked]);
    const released = await lead({ sent });
    await pool.query(
      `INSERT INTO dnc_list (phone, reason, released_at, released_reason) SELECT phone, 'sms_stop', now(), 'sms_start' FROM leads WHERE id = $1`,
      [released]
    );
    const called = await lead({ sent });
    await startAutomatedCall({ leadId: called, mayRing: () => true });
    const finished = await lead({ sent, status: 'completed' });
    const expired = await lead({ sent, status: 'expired' });
    const stopped = await lead({ sent, status: 'suppressed' });

    const picked = await due();
    const excluded = { notYet, neverTexted, before, texted, rang, held, noted, closed, blocked, called, finished, expired, stopped };
    for (const [why, id] of Object.entries(excluded)) {
      check(`not picked: ${why}`, picked.includes(id), false);
    }
    check('a block lifted by START: picked', picked.includes(released), true);
    check('oldest first text first', picked, [released, ready]);

    check('only the test numbers, outside production', await due({ only: ['+15550001001'] }), [ready]);
    check('up to the room', await due({ limit: 1 }), [released]);
    check('arrived before automated calls were switched on: never', (await due({ since: new Date('2026-10-26T16:00:00Z') })).length, 0);
  }

  console.log('\nthe leads already waiting at the switch-on');
  {
    // Two that arrived before the switch-on and never replied; two new ones.
    const only = ['+15550009201', '+15550009202', '+15550009203', '+15550009204'];
    const oldest = await lead({ sent: new Date('2026-10-19T19:30:00Z'), arrived: new Date('2026-10-19T19:30:00Z'), phone: only[0] });
    const older = await lead({ sent: new Date('2026-10-19T21:00:00Z'), arrived: new Date('2026-10-19T21:00:00Z'), phone: only[1] });
    const newer = await lead({ sent: new Date(NOW.getTime() - minutes(120)), phone: only[2] });
    const newest = await lead({ sent: new Date(NOW.getTime() - minutes(90)), phone: only[3] });
    check('not included: the new leads only', await due({ only }), [newer, newest]);
    check('included: the new leads first, then the waiting ones, oldest first', await due({ only, waiting: 'also' }), [
      newer,
      newest,
      oldest,
      older,
    ]);
    check('the room goes to the new leads first', await due({ only, waiting: 'also', limit: 2 }), [newer, newest]);
    check('and what is left to the waiting ones', await due({ only, waiting: 'also', limit: 3 }), [newer, newest, oldest]);
    check('the waiting ones alone, for the command', await due({ only, waiting: 'only' }), [oldest, older]);
    const asked = { now: NOW, since: SINCE, waitMinutes: 60, only, leadId: oldest };
    check('asked again before its call: due only while included', [await stillDue(asked), await stillDue({ ...asked, waiting: 'also' })], [
      false,
      true,
    ]);
    await pool.query(`INSERT INTO messages (lead_id, direction, body) VALUES ($1, 'inbound', 'stop texting')`, [older]);
    const picked = await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [newest, maya]);
    check('the same rules as any lead: one who replied, one picked up - never', [picked.rowCount, await due({ only, waiting: 'also' })], [
      1,
      [newer, oldest],
    ]);
  }

  console.log('\nincluding them - auto-calls:include-waiting');
  {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
    const records = async () =>
      (await pool.query(`SELECT action, detail FROM activity_log WHERE action LIKE 'auto_calls.waiting_%' ORDER BY id`)).rows;
    const state = await autoCallsState();
    const since = state.since?.toISOString() ?? '';
    check('automated calls on, since the last switch-on; the waiting leads not called', [state.on, state.waitingIncluded, await waitingIncluded()], [
      true,
      false,
      false,
    ]);
    check('included', await setWaitingIncluded(true, 7), { kind: 'changed', since });
    check('read on every look: included', [await waitingIncluded(), (await autoCallsState()).waitingIncluded], [true, true]);
    check('recorded, with the switch-on and how many were due', await records(), [
      { action: 'auto_calls.waiting_included', detail: { since, waiting: 7 } },
    ]);
    check('asked again: nothing written, nothing recorded', [await setWaitingIncluded(true, 7), (await records()).length], [
      { kind: 'unchanged', since },
      1,
    ]);
    check('stopped', await setWaitingIncluded(false, 0), { kind: 'changed', since });
    check('no longer called', await waitingIncluded(), false);
    check('the stop recorded', (await records()).map((r) => [r.action, r.detail]), [
      ['auto_calls.waiting_included', { since, waiting: 7 }],
      ['auto_calls.waiting_stopped', { since }],
    ]);
    check('stopped again: nothing changes', [await setWaitingIncluded(false, 0), (await records()).length], [{ kind: 'unchanged', since }, 2]);

    await setWaitingIncluded(true, 3);
    await pause();
    await recordAutoCallsSwitch(true);
    check('the worker restarted while on: still included', await waitingIncluded(), true);
    await recordAutoCallsSwitch(false);
    check('switched off: refused - there is nothing to add them to', await setWaitingIncluded(true, 3), { kind: 'off' });
    await pause();
    await recordAutoCallsSwitch(true);
    check('switched on again: afresh - the leads waiting then are not called', await waitingIncluded(), false);
    check('the earlier switch-on\'s choice kept on record, nothing removed', (await records()).length, 3);
  }

  console.log('\nwhen - the first look after the hour is up, and overnight');
  {
    // Fresh leads for this section, looked at by their own numbers alone.
    const evening = await lead({ sent: new Date('2026-10-26T23:30:00Z'), phone: '+15550009001' }); // Monday 16:30
    const morning = await lead({ sent: new Date('2026-10-27T17:30:00Z'), phone: '+15550009002' }); // Tuesday 10:30
    const only = ['+15550009001', '+15550009002'];
    const at = (iso: string) => due({ now: new Date(iso), only });
    check('an hour after: not a second before', await at('2026-10-27T00:29:59Z'), []);
    check('and on the first look after', await at('2026-10-27T00:30:01Z'), [evening]);
    check('its hour ended outside the hours - at 11am the next day, it is first', await at('2026-10-27T18:00:00Z'), [evening]);
    check('the morning\'s lead once its own hour is up, after it', await at('2026-10-27T18:31:00Z'), [evening, morning]);
  }

  console.log('\nthe room - people free, the robot\'s calls going, a lead on hold');
  {
    // The robot's call above, for the lead already called, is going: placed,
    // no end, nobody on it.
    check('nobody free; one of the robot\'s calls going', await dialRoom(), {
      free: 0,
      underway: 1,
      onHold: false,
      silent: 0,
      scripted: true,
    });
    await person('ann@example.com', true);
    await person('ben@example.com', true);
    await person('off@example.com', false);
    check('two free - not the one with the switch off', (await dialRoom()).free, 2);

    const going = await lead({ sent: new Date(NOW.getTime() - minutes(90)) });
    const started = await startAutomatedCall({ leadId: going, mayRing: () => true });
    const callId = started.ok ? started.callId : 0;
    await linkAutomatedCall(callId, 'CA-DIAL-1');
    check('another going: two', (await dialRoom()).underway, 2);
    await holdCall(callId);
    check('a lead on hold', (await dialRoom()).onHold, true);
    await pool.query(`UPDATE calls SET held_at = now() - interval '13 minutes' WHERE id = $1`, [callId]);
    check('on hold longer than the safety stop and two minutes: a call whose end never came - not counted', (await dialRoom()).onHold, false);
    await pool.query(`UPDATE calls SET outcome = 'answered', ended_at = now(), script_result = 'transfer_missed' WHERE id = $1`, [callId]);
    check('ended: neither going nor on hold', await dialRoom(), { free: 2, underway: 1, onHold: false, silent: 0, scripted: true });

    // Twilio's reports not reaching us: a call placed a while ago, never heard of.
    const quiet = await lead({ sent: new Date(NOW.getTime() - minutes(90)) });
    const q = await startAutomatedCall({ leadId: quiet, mayRing: () => true });
    const quietId = q.ok ? q.callId : 0;
    await linkAutomatedCall(quietId, 'CA-QUIET-1');
    await pool.query(`UPDATE calls SET started_at = now() - interval '5 minutes' WHERE id = $1`, [quietId]);
    check('placed 5 minutes ago, no end, no verdict: silent', (await dialRoom()).silent, 1);
    await pool.query(`UPDATE calls SET answered_by = 'human' WHERE id = $1`, [quietId]);
    check('a verdict came: heard of', (await dialRoom()).silent, 0);
    await pool.query(`UPDATE calls SET answered_by = NULL, started_at = now() - interval '61 minutes' WHERE id = $1`, [quietId]);
    check('silent, but over an hour ago: no longer stops it', (await dialRoom()).silent, 0);
    await pool.query(`UPDATE calls SET outcome = 'completed', ended_at = now(), script_result = 'hung_up' WHERE id = $1`, [quietId]);

    await pool.query(`UPDATE call_scripts SET is_active = false`);
    check('no call script active', (await dialRoom()).scripted, false);
    await pool.query(`UPDATE call_scripts SET is_active = true`);
  }

  console.log('\na look, end to end - never more calls than people free');
  {
    // Three more due, two free, one of the robot's calls still going: one call.
    const only = ['+15550009101', '+15550009102', '+15550009103'];
    for (const phone of only) await lead({ sent: new Date(NOW.getTime() - minutes(120)), phone });
    const placed: number[] = [];
    const look: DialDeps = {
      closeUnplacedCalls: async () => 0,
      autoCallsSince: async () => SINCE,
      waitingIncluded: async () => false,
      readCallHours: async () => DEFAULT_CALL_HOURS,
      dialRoom,
      leadsToCall: (opts) => leadsToCall({ ...opts, only }),
      stillDue: (opts) => stillDue({ ...opts, only }),
      // Twilio not asked: the row is what counts here.
      placeAutoCall: async (leadId) => {
        const started = await startAutomatedCall({ leadId, mayRing: () => true });
        if (started.ok) placed.push(leadId);
        return started.ok ? { kind: 'placed', callId: started.callId } : { kind: 'refused', reason: started.reason };
      },
      withDialLock,
    };
    const first = await dialDueLeads(look, NOW);
    check('two free, one going: one call placed', [first.room, first.placed], [1, 1]);
    const second = await dialDueLeads(look, NOW);
    check('the next look: that call going too - none', [second.room, second.placed], [0, 0]);
    check('each lead called once at most', new Set(placed).size, placed.length);
  }

  console.log('\ntwo workers never dial at once');
  {
    let release: () => void = () => undefined;
    const holding = withDialLock(() => new Promise<string>((resolve) => (release = () => resolve('first'))));
    await new Promise((resolve) => setTimeout(resolve, 50));
    check('while one dials, another looks up nothing', await withDialLock(async () => 'second'), null);
    release();
    check('the first finishes', await holding, 'first');
    check('then the lock is free again', await withDialLock(async () => 'third'), 'third');
  }

  console.log('\na call that never reached Twilio');
  {
    const stale = await lead({ sent: new Date(NOW.getTime() - minutes(90)) });
    const s = await startAutomatedCall({ leadId: stale, mayRing: () => true });
    const staleId = s.ok ? s.callId : 0;
    await pool.query(`UPDATE calls SET started_at = now() - interval '11 minutes' WHERE id = $1`, [staleId]);
    const fresh = await lead({ sent: new Date(NOW.getTime() - minutes(90)) });
    const f = await startAutomatedCall({ leadId: fresh, mayRing: () => true });
    const freshId = f.ok ? f.callId : 0;
    const before = await closeUnplacedCalls();
    const { rows } = await pool.query(
      `SELECT id, outcome, script_result, ended_at IS NOT NULL AS ended FROM calls WHERE id = ANY($1) ORDER BY id`,
      [[staleId, freshId]]
    );
    check('ten minutes with no webhook naming it: closed, failed, unanswered', rows, [
      { id: staleId, outcome: 'failed', script_result: 'unanswered', ended: true },
      { id: freshId, outcome: null, script_result: null, ended: false },
    ]);
    check('the others left alone - one closed (the calls above reached Twilio, or are newer)', before >= 1, true);
    const ended = await pool.query(
      `SELECT detail->>'reason' AS reason FROM activity_log WHERE action = 'call.ended' AND (detail->>'callId')::int = $1`,
      [staleId]
    );
    check('with its record - no webhook named it, which is all that is known', ended.rows, [{ reason: 'no_webhook' }]);
    check('closed once', await closeUnplacedCalls(), 0);
    check('a webhook naming it after that is not taken for it', await linkAutomatedCall(staleId, 'CA-LATE-1'), false);
    check('one naming a call still open is, as ever', await linkAutomatedCall(freshId, 'CA-FRESH-1'), true);
  }

  console.log('\nasked again just before its call');
  {
    const due = { now: NOW, since: SINCE, waitMinutes: 60, only: null };
    const ready = await lead({ sent: new Date(NOW.getTime() - minutes(70)) });
    check('still due', await stillDue({ ...due, leadId: ready }), true);
    await pool.query(`INSERT INTO messages (lead_id, direction, body) VALUES ($1, 'inbound', 'call me later')`, [ready]);
    check('replied meanwhile: no longer', await stillDue({ ...due, leadId: ready }), false);
    const picked = await lead({ sent: new Date(NOW.getTime() - minutes(70)) });
    await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [picked, maya]);
    check('picked up meanwhile: no longer', await stillDue({ ...due, leadId: picked }), false);
  }

  console.log('\nhow far back it looks');
  {
    const old = await lead({ sent: new Date(NOW.getTime() - minutes(70)), arrived: new Date('2026-09-20T12:00:00Z') });
    const looked = await leadsToCall({ now: NOW, since: new Date('2026-01-01T00:00:00Z'), waitMinutes: 60, only: null, limit: 100 });
    check('a lead from over 30 days back is not looked at - no conversation stays open that long', looked.includes(old), false);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
