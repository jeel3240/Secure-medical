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
import { finishCall, recordAnsweredBy, startCall, startIncomingCall } from '../src/db/calls';
import { saveRecording } from '../src/db/transcripts';
import * as transcriptClient from '../src/integrations/twilio-transcripts';
import { advanceTranscripts } from '../src/worker/transcripts';
import { createCallback, listCallbacks } from '../src/db/callbacks';
import { getLeadDetail } from '../src/db/lead-detail';
import { listQueue } from '../src/db/queue';
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

/** Closes the lead the way an agent's Closed does, without the release. */
async function setClosed(leadId: number, agentId: number): Promise<void> {
  await pool.query(`INSERT INTO dispositions (lead_id, agent_id, value) VALUES ($1, $2, 'closed')`, [leadId, agentId]);
  await pool.query(`UPDATE leads SET assigned_to = NULL, assigned_at = NULL WHERE id = $1`, [leadId]);
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

    check('the result is saved', (await finishCall({ callSid: 'CA-7', outcome: 'answered', durationSec: 134 })).recorded, true);
    check('with its talk time, and an end', await callRows(lead), [
      { sid: 'CA-7', agent_id: maya, outcome: 'answered', duration_sec: 134, started: true, ended: true },
    ]);

    check('a second report changes nothing', (await finishCall({ callSid: 'CA-7', outcome: 'failed', durationSec: 0 })).recorded, false);
    check('the first outcome stands', (await callRows(lead))[0].outcome, 'answered');
    check('a report for a call we never started is ignored', (await finishCall({ callSid: 'CA-nope', outcome: 'busy', durationSec: 0 })).recorded, false);
  }

  console.log('\nwhat a call shows up as');
  {
    const lead = await makeLead('+15550000607', 'Shown', maya);
    await startCall({ callSid: 'CA-8', leadId: lead, agentId: maya });
    await finishCall({ callSid: 'CA-8', outcome: 'no_answer', durationSec: 0 });

    const entry = (await getTimeline(lead))!.find((e) => e.kind === 'call');
    check('on the timeline, with who called and how it went', entry && { author: entry.author, detail: entry.detail }, {
      author: 'Maya',
      detail: { outcome: 'no_answer', durationSec: 0, direction: 'outbound' },
    });

    // A lead that has been called has been worked, even once it is let go.
    await pool.query(`UPDATE leads SET assigned_to = NULL, assigned_at = NULL WHERE id = $1`, [lead]);
    const admin = await listAdminLeads({ pageSize: 200 });
    check('and its lead reads Working on Admin > Leads', admin.leads.find((l) => l.id === lead)?.status, 'working');
  }

  console.log('\nvoicemail: a machine picked up, not the lead');
  {
    const lead = await makeLead('+15550000640', 'Voicemail', maya);
    const row = async (sid: string) =>
      (await pool.query(`SELECT outcome, answered_by, duration_sec FROM calls WHERE twilio_call_sid = $1`, [sid])).rows[0];
    const log = async (sid: string) =>
      (
        await pool.query(
          `SELECT detail->>'answeredBy' AS by, detail->>'outcome' AS outcome, detail->>'outcomeWas' AS was
           FROM activity_log WHERE action = 'call.answered_by' AND detail->>'callSid' = $1`,
          [sid]
        )
      ).rows;

    // The verdict arrives while the call is still up - the usual order.
    await startCall({ callSid: 'CA-50', leadId: lead, agentId: maya });
    check('the verdict is saved', await recordAnsweredBy({ callSid: 'CA-50', answeredBy: 'machine' }), true);
    check('with no outcome yet - the call is not over', await row('CA-50'), { outcome: null, answered_by: 'machine', duration_sec: null });
    await finishCall({ callSid: 'CA-50', outcome: 'answered', durationSec: 22 });
    check('when it ends it is voicemail, not answered, with the length of the message left', await row('CA-50'), {
      outcome: 'voicemail',
      answered_by: 'machine',
      duration_sec: 22,
    });

    // A short call: it is over before detection reports.
    await startCall({ callSid: 'CA-51', leadId: lead, agentId: maya });
    await finishCall({ callSid: 'CA-51', outcome: 'answered', durationSec: 4 });
    check('saved as answered until the verdict comes', (await row('CA-51')).outcome, 'answered');
    await recordAnsweredBy({ callSid: 'CA-51', answeredBy: 'machine' });
    check('then corrected to voicemail', (await row('CA-51')).outcome, 'voicemail');
    check('and the record keeps what it said before', await log('CA-51'), [{ by: 'machine', outcome: 'voicemail', was: 'answered' }]);

    await startCall({ callSid: 'CA-52', leadId: lead, agentId: maya });
    await recordAnsweredBy({ callSid: 'CA-52', answeredBy: 'human' });
    await finishCall({ callSid: 'CA-52', outcome: 'answered', durationSec: 90 });
    check('a person picking up is answered', await row('CA-52'), { outcome: 'answered', answered_by: 'human', duration_sec: 90 });

    await startCall({ callSid: 'CA-53', leadId: lead, agentId: maya });
    await recordAnsweredBy({ callSid: 'CA-53', answeredBy: 'unknown' });
    await finishCall({ callSid: 'CA-53', outcome: 'answered', durationSec: 30 });
    check('Twilio not being sure is left as answered, not guessed', (await row('CA-53')).outcome, 'answered');

    await startCall({ callSid: 'CA-54', leadId: lead, agentId: maya });
    await recordAnsweredBy({ callSid: 'CA-54', answeredBy: 'machine' });
    await finishCall({ callSid: 'CA-54', outcome: 'no_answer', durationSec: 0 });
    check('a call nobody picked up is not voicemail, whatever the verdict', (await row('CA-54')).outcome, 'no_answer');

    check('only the first verdict counts', await recordAnsweredBy({ callSid: 'CA-52', answeredBy: 'machine' }), false);
    check('and the call stays as it was', (await row('CA-52')).outcome, 'answered');
    check('a verdict for a call we never placed is ignored', await recordAnsweredBy({ callSid: 'CA-nope', answeredBy: 'machine' }), false);

    const entry = (await getTimeline(lead))!.filter((e) => e.kind === 'call').map((e) => e.detail.outcome);
    check('the timeline says which was which', entry, ['voicemail', 'voicemail', 'answered', 'answered', 'no_answer']);
  }

  console.log('\nrecordings and transcripts');
  {
    // The worker reads calling's settings from the environment; the Twilio
    // transcription service is answered here instead of asked.
    Object.assign(process.env, {
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_AUTH_TOKEN: 'a'.repeat(32),
      TWILIO_API_KEY: `SK${'a'.repeat(32)}`,
      TWILIO_API_SECRET: 'A'.repeat(32),
      TWILIO_TWIML_APP_SID: `AP${'a'.repeat(32)}`,
      TWILIO_PHONE_NUMBER: '+14804708259',
      PUBLIC_URL: 'https://calls.example.com',
      TWILIO_TRANSCRIPTION_SERVICE_SID: `GA${'a'.repeat(32)}`,
    });
    const twilioTranscripts = transcriptClient as unknown as {
      requestTranscript: (...a: unknown[]) => Promise<string>;
      readTranscript: (...a: unknown[]) => Promise<unknown>;
    };
    let requests = 0;
    twilioTranscripts.requestTranscript = async () => `GT${String(++requests).padStart(32, '0')}`;
    let ready = false;
    twilioTranscripts.readTranscript = async () =>
      ready
        ? {
            state: 'completed',
            sentences: [
              { mediaChannel: 2, transcript: 'Yes, this is Priya.', startTime: '2.1' },
              { mediaChannel: 1, transcript: 'Hi Priya, it is Maya.', startTime: '0.5' },
            ],
          }
        : { state: 'waiting' };

    const lead = await makeLead('+15550000660', 'Recorded', maya);
    await startCall({ callSid: 'CA-60', leadId: lead, agentId: maya });
    await finishCall({ callSid: 'CA-60', outcome: 'answered', durationSec: 40 });
    const recording = { callSid: 'CA-60', recordingSid: `RE${'6'.repeat(32)}`, durationSec: 40, channels: 2 };
    check('a finished recording is kept', await saveRecording(recording), true);
    check('Twilio retrying the callback keeps it once', await saveRecording(recording), false);
    const transcript = async () =>
      (await pool.query(`SELECT status, transcript_sid IS NOT NULL AS sent, sentences FROM call_transcripts WHERE call_id = (SELECT id FROM calls WHERE twilio_call_sid = 'CA-60')`)).rows;
    check('and its transcript is in line', (await transcript()).map((t) => t.status), ['pending']);
    check('a recording for a call we never placed is ignored', await saveRecording({ ...recording, callSid: 'CA-none', recordingSid: `RE${'7'.repeat(32)}` }), false);

    const first = await advanceTranscripts();
    check('the worker asks Twilio for it', [first.requested, (await transcript())[0].status, (await transcript())[0].sent], [1, 'queued', true]);
    check('and waits while Twilio works', (await advanceTranscripts()).waiting, 1);
    ready = true;
    check('then stores it', (await advanceTranscripts()).completed, 1);
    // Read back in a fixed key order: JSONB keeps its own.
    const said = ((await transcript())[0].sentences as { speaker: string; text: string; startSec: number }[]).map(
      ({ speaker, text, startSec }) => ({ speaker, text, startSec })
    );
    check('who said what, in order: we called, so channel 1 is the agent', said, [
      { speaker: 'agent', text: 'Hi Priya, it is Maya.', startSec: 0.5 },
      { speaker: 'lead', text: 'Yes, this is Priya.', startSec: 2.1 },
    ]);
    check('nothing is asked again once it is done', (await advanceTranscripts()).requested + requests, 1);

    const entry = (await getTimeline(lead))!.find((e) => e.kind === 'call');
    check('the timeline carries it under the call', (entry?.detail.transcript as { status: string } | undefined)?.status, 'completed');
    const log = (await pool.query(`SELECT action FROM activity_log WHERE lead_id = $1 AND action LIKE 'call.%' ORDER BY id`, [lead])).rows.map((r) => r.action);
    check('and the activity log has each step', log.filter((a) => a === 'call.recorded' || a === 'call.transcribed'), ['call.recorded', 'call.transcribed']);

    // Twilio refusing to start it: tried again, then given up, and said so.
    const refused = await makeLead('+15550000661', 'Refused', maya);
    await startCall({ callSid: 'CA-61', leadId: refused, agentId: maya });
    await finishCall({ callSid: 'CA-61', outcome: 'answered', durationSec: 10 });
    await saveRecording({ ...recording, callSid: 'CA-61', recordingSid: `RE${'8'.repeat(32)}` });
    twilioTranscripts.requestTranscript = async () => {
      throw new Error('Twilio said no');
    };
    for (let i = 0; i < 4; i++) await advanceTranscripts();
    check('a refusal is tried again', (await pool.query(`SELECT status, attempts FROM call_transcripts WHERE call_id = (SELECT id FROM calls WHERE twilio_call_sid = 'CA-61')`)).rows[0], { status: 'pending', attempts: 4 });
    await advanceTranscripts();
    check('and given up after five', (await pool.query(`SELECT status FROM call_transcripts WHERE call_id = (SELECT id FROM calls WHERE twilio_call_sid = 'CA-61')`)).rows[0].status, 'failed');
    const failedEntry = (await getTimeline(refused))!.find((e) => e.kind === 'call');
    check('which the timeline says', (failedEntry?.detail.transcript as { status: string } | undefined)?.status, 'failed');
  }

  console.log('\na lead calling our number: who rings');
  {
    const held = await makeLead('+15550000611', 'HeldBySam', sam);
    check('the agent holding the lead', await startIncomingCall({ callSid: 'IN-1', fromPhone: '+15550000611' }), {
      kind: 'ring',
      agentId: sam,
      lead: { id: held, name: 'HeldBySam', phone: '+15550000611' },
    });

    // Nobody holds it now, but Maya rang them earlier: hers is the call being returned.
    const called = await makeLead('+15550000612', 'CalledByMaya', maya);
    await startCall({ callSid: 'CA-20', leadId: called, agentId: maya });
    await finishCall({ callSid: 'CA-20', outcome: 'no_answer', durationSec: 0 });
    await pool.query(`UPDATE leads SET assigned_to = NULL, assigned_at = NULL WHERE id = $1`, [called]);
    const back = await startIncomingCall({ callSid: 'IN-2', fromPhone: '+15550000612' });
    check('failing that, the agent who last called them', back.kind === 'ring' && back.agentId, maya);

    await pool.query(`UPDATE leads SET assigned_to = $2 WHERE id = $1`, [called, sam]);
    const both = await startIncomingCall({ callSid: 'IN-3', fromPhone: '+15550000612' });
    check('the holder comes before the last caller', both.kind === 'ring' && both.agentId, sam);

    const stale = await makeLead('+15550000613', 'HeldByGone', gone);
    check('a deactivated agent is never rung', (await startIncomingCall({ callSid: 'IN-4', fromPhone: '+15550000613' })).kind, 'missed');

    check('a number we hold no lead for', await startIncomingCall({ callSid: 'IN-5', fromPhone: '+15559990001' }), { kind: 'unknown' });
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM calls WHERE twilio_call_sid = 'IN-5'`);
    check('leaves no call row - only a record of the number', rows[0].n, 0);
    const log = await pool.query(`SELECT detail->>'phone' AS phone FROM activity_log WHERE action = 'call.incoming' AND detail->>'callSid' = 'IN-5'`);
    check('in the activity log', log.rows, [{ phone: '+15559990001' }]);
    void stale;
  }

  console.log('\na lead calling our number: nobody to ring');
  {
    const lead = await makeLead('+15550000614', 'NeverWorked', null);
    check('is a missed call at once', await startIncomingCall({ callSid: 'IN-6', fromPhone: '+15550000614' }), {
      kind: 'missed',
      leadId: lead,
      firstReport: true,
    });
    check('saved as missed, incoming, with no agent', (await pool.query(
      `SELECT direction, agent_id, outcome, duration_sec, ended_at IS NOT NULL AS ended FROM calls WHERE twilio_call_sid = 'IN-6'`
    )).rows, [{ direction: 'inbound', agent_id: null, outcome: 'missed', duration_sec: 0, ended: true }]);
    const again = await startIncomingCall({ callSid: 'IN-6', fromPhone: '+15550000614' });
    check('a retried webhook is not a second missed call', again.kind === 'missed' && again.firstReport, false);
  }

  console.log('\na lead calling our number: how it ends');
  {
    const lead = await makeLead('+15550000615', 'Rings', maya);
    await startIncomingCall({ callSid: 'IN-7', fromPhone: '+15550000615' });
    check('answered: saved as answered, and nobody is texted', await finishCall({ callSid: 'IN-7', outcome: 'answered', durationSec: 75 }), {
      recorded: true,
      missedLeadId: null,
    });

    await startIncomingCall({ callSid: 'IN-8', fromPhone: '+15550000615' });
    check('not answered: saved as missed, whatever Twilio called it, and the lead is to be texted', await finishCall({ callSid: 'IN-8', outcome: 'no_answer', durationSec: 0 }), {
      recorded: true,
      missedLeadId: lead,
    });
    check('once only', await finishCall({ callSid: 'IN-8', outcome: 'canceled', durationSec: 0 }), { recorded: false, missedLeadId: null });
    check('the row says missed', (await pool.query(`SELECT outcome FROM calls WHERE twilio_call_sid = 'IN-8'`)).rows[0].outcome, 'missed');

    const out = await finishCall({ callSid: 'CA-1', outcome: 'no_answer', durationSec: 0 });
    check('an outgoing call nobody answered is still no_answer, not missed', [out.missedLeadId, (await pool.query(`SELECT outcome FROM calls WHERE twilio_call_sid = 'CA-1'`)).rows[0].outcome], [null, 'no_answer']);
  }

  console.log('\na missed call puts the lead in front of someone');
  {
    const lead = await makeLead('+15550000616', 'MissedMe', maya);
    await setClosed(lead, maya);
    const inQueue = async () => (await listQueue({ limit: 200 })).leads.find((l) => l.id === lead)?.tag ?? 'absent';
    check('a closed lead is not in the queue', await inQueue(), 'absent');

    await pool.query(`UPDATE leads SET assigned_to = $2 WHERE id = $1`, [lead, maya]);
    await startIncomingCall({ callSid: 'IN-9', fromPhone: '+15550000616' });
    await pool.query(`UPDATE leads SET assigned_to = NULL, assigned_at = NULL WHERE id = $1`, [lead]);
    await finishCall({ callSid: 'IN-9', outcome: 'no_answer', durationSec: 0 });
    check('their missed call brings them back, marked', await inQueue(), { kind: 'missed_call' });

    // They ring again and this time it is ringing through: while that call is
    // under way nobody should be told the lead went unanswered.
    await pool.query(`UPDATE leads SET assigned_to = $2 WHERE id = $1`, [lead, maya]);
    await startIncomingCall({ callSid: 'IN-10', fromPhone: '+15550000616' });
    check('a call under way is not a missed call', (await getLeadDetail(lead))?.flags.missedCall, false);
    await pool.query(`UPDATE calls SET started_at = now() - interval '3 hours' WHERE twilio_call_sid = 'IN-10'`);
    check('unless it is a stale row whose end never arrived', (await getLeadDetail(lead))?.flags.missedCall, true);
    await pool.query(`UPDATE calls SET started_at = now() WHERE twilio_call_sid = 'IN-10'`);
    await finishCall({ callSid: 'IN-10', outcome: 'no_answer', durationSec: 0 });
    check('and if it too goes unanswered, the lead is missed again', (await getLeadDetail(lead))?.flags.missedCall, true);
    await pool.query(`UPDATE leads SET assigned_to = NULL, assigned_at = NULL WHERE id = $1`, [lead]);
    const admin = async () => (await listAdminLeads({ pageSize: 200 })).leads.find((l) => l.id === lead)?.status;
    check('and it is no longer Closed on Admin > Leads', await admin(), 'working');

    await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [lead, maya]);
    await startCall({ callSid: 'CA-30', leadId: lead, agentId: maya });
    await pool.query(`UPDATE leads SET assigned_to = NULL, assigned_at = NULL WHERE id = $1`, [lead]);
    check('calling them back clears it: closed again, out of the queue', [await inQueue(), await admin()], ['absent', 'closed']);
  }

  console.log('\na missed call becomes a callback for the agent it rang');
  {
    const lead = await makeLead('+15550000617', 'OwedACall', maya);
    const open = async () =>
      (
        await pool.query(
          `SELECT agent_id, reason, done_at IS NOT NULL AS done, scheduled_at <= now() AS due
           FROM callbacks WHERE lead_id = $1 ORDER BY id`,
          [lead]
        )
      ).rows;
    const logged = async (action: string) =>
      (
        await pool.query(
          `SELECT actor_id, subject_user_id, detail->>'because' AS because
           FROM activity_log WHERE lead_id = $1 AND action = $2 ORDER BY id`,
          [lead, action]
        )
      ).rows;

    await startIncomingCall({ callSid: 'IN-20', fromPhone: '+15550000617' });
    check('nothing is booked while it rings', await open(), []);
    await finishCall({ callSid: 'IN-20', outcome: 'no_answer', durationSec: 0 });
    check('missed: one callback, theirs, due now', await open(), [{ agent_id: maya, reason: 'missed_call', done: false, due: true }]);
    check('recorded as booked by the system, for them', await logged('callback.booked'), [
      { actor_id: null, subject_user_id: maya, because: 'missed_call' },
    ]);
    const tab = async (when: 'today' | 'overdue') =>
      (await listCallbacks({ agentId: maya, when })).callbacks.find((c) => c.leadId === lead)?.reason ?? 'absent';
    check('on their My Callbacks under Today, marked as a missed call', await tab('today'), 'missed_call');
    check('and not under Overdue, though its time has passed', await tab('overdue'), 'absent');
    const counts = (await listCallbacks({ agentId: maya, when: 'today' })).counts;
    check('the tab counts agree', [counts.today >= 1, counts.overdue], [true, 0]);
    await pool.query(`UPDATE callbacks SET scheduled_at = now() - interval '2 days' WHERE lead_id = $1`, [lead]);
    check('one from an earlier day is overdue', [await tab('today'), await tab('overdue')], ['absent', 'missed_call']);
    await pool.query(`UPDATE callbacks SET scheduled_at = now() WHERE lead_id = $1`, [lead]);

    await startIncomingCall({ callSid: 'IN-21', fromPhone: '+15550000617' });
    await finishCall({ callSid: 'IN-21', outcome: 'no_answer', durationSec: 0 });
    check('a second missed call is not a second callback', (await open()).length, 1);
    const row = (await listCallbacks({ agentId: maya, when: 'today' })).callbacks.find((c) => c.leadId === lead)!;
    const last = (await pool.query(`SELECT started_at FROM calls WHERE twilio_call_sid = 'IN-21'`)).rows[0].started_at;
    check('but the row says two, and when the latest was', row.missedCalls, { count: 2, lastAt: last.toISOString() });

    await startCall({ callSid: 'CA-40', leadId: lead, agentId: maya });
    check('calling them back finishes it', (await open())[0].done, true);
    check('recorded, with who called', await logged('callback.done'), [
      { actor_id: maya, subject_user_id: maya, because: 'called_back' },
    ]);
    await finishCall({ callSid: 'CA-40', outcome: 'no_answer', durationSec: 0 });

    // Missed again; this time the lead rings once more and gets through.
    await startIncomingCall({ callSid: 'IN-22', fromPhone: '+15550000617' });
    await finishCall({ callSid: 'IN-22', outcome: 'no_answer', durationSec: 0 });
    check('a later missed call books a new one', (await open()).map((c) => c.done), [true, false]);
    await startIncomingCall({ callSid: 'IN-23', fromPhone: '+15550000617' });
    await finishCall({ callSid: 'IN-23', outcome: 'answered', durationSec: 40 });
    check('answering when they ring again finishes it', (await open()).map((c) => c.done), [true, true]);
    check('recorded as answered', (await logged('callback.done'))[1], { actor_id: maya, subject_user_id: maya, because: 'answered' });

    // A callback the agent booked themselves is theirs to finish.
    await createCallback(lead, maya, new Date(Date.now() + 3600_000));
    await startCall({ callSid: 'CA-41', leadId: lead, agentId: maya });
    check('a callback an agent booked is never finished for them', (await open()).map((c) => [c.reason, c.done]), [
      ['missed_call', true],
      ['missed_call', true],
      ['booked', false],
    ]);

    // What else settles a missed call, and what does not.
    const settled = await makeLead('+15550000620', 'Settled', maya);
    const miss = async (sid: string) => {
      await pool.query(`UPDATE leads SET assigned_to = $2 WHERE id = $1`, [settled, maya]);
      await startIncomingCall({ callSid: sid, fromPhone: '+15550000620' });
      await finishCall({ callSid: sid, outcome: 'no_answer', durationSec: 0 });
    };
    const flag = async () => (await getLeadDetail(settled))?.flags.missedCall;
    await miss('IN-30');
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, sent_by, delivery_status, created_at)
       VALUES ($1, 'outbound', 'hi', $2, 'failed', now() + interval '1 second')`,
      [settled, maya]
    );
    check('a text EZ Texting refused has not got back to them', await flag(), true);
    await pool.query(
      `INSERT INTO dispositions (lead_id, agent_id, value, created_at) VALUES ($1, $2, 'closed', now() + interval '2 seconds')`,
      [settled, maya]
    );
    await pool.query(`UPDATE leads SET assigned_to = NULL, assigned_at = NULL WHERE id = $1`, [settled]);
    check('an outcome saved afterwards settles it: closed, and out of the queue', [
      await flag(),
      (await listAdminLeads({ pageSize: 200 })).leads.find((l) => l.id === settled)?.status,
      (await listQueue({ limit: 200 })).leads.some((l) => l.id === settled),
    ], [false, 'closed', false]);

    const blocked = await makeLead('+15550000618', 'BlockedCaller', maya);
    await pool.query(`INSERT INTO dnc_list (phone, reason) VALUES ('+15550000618', 'agent')`);
    await startIncomingCall({ callSid: 'IN-24', fromPhone: '+15550000618' });
    await finishCall({ callSid: 'IN-24', outcome: 'no_answer', durationSec: 0 });
    check('no callback for a number on the do-not-call list', (await pool.query(`SELECT 1 FROM callbacks WHERE lead_id = $1`, [blocked])).rowCount, 0);

    const nobody = await makeLead('+15550000619', 'RangNobody', null);
    await startIncomingCall({ callSid: 'IN-25', fromPhone: '+15550000619' });
    check('nor when the call rang nobody: it waits in the queue', (await pool.query(`SELECT 1 FROM callbacks WHERE lead_id = $1`, [nobody])).rowCount, 0);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
