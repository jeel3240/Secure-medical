/**
 * Proves db/agent-sms.ts and rule 2b against a real Postgres.
 *
 * The state machine's own tests prove the rule as a pure function. What they
 * cannot show is that the timestamp written by a send is the one the reply path
 * reads back - the column has to be in the UPDATE, in the SELECT, and mapped
 * onto the field the rule checks, and a break in any of those three silently
 * restores the automated questions.
 *
 * EZ Texting is stubbed: nothing is texted. It writes rows, so it refuses to
 * run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE sms_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/sms_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/sms_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x EZT_SEND_GROUP=x \n *     npx ts-node --transpile-only scripts/agent-sms-live-check.ts
 *
 * EZT_SEND_GROUP must be set because the real sendMessage runs - only its HTTP
 * call is stubbed.
 */
import { pool } from '../src/db/pool';
import { replyAs, startFlow } from './live-flow';
import axios from 'axios';

// Stubbed at the HTTP boundary, not at sendMessage.
//
// Replacing sendMessage itself would skip the dnc_list check that lives inside
// it - the only thing stopping an agent texting a number that has opted out -
// and the script would then "prove" a compliance guard it had just removed.
// The first run of this file did exactly that. Stubbing axios.post leaves the
// real sendMessage, its EZT_SEND_GROUP guard and its dnc_list check in the
// path, and only the network call is faked. Nothing leaves the machine.
let sent: { to: string[]; body: string }[] = [];
let failNext: Error | null = null;
/**
 * Never reset, unlike `sent`. messages.ezt_message_id has a partial unique
 * index on outbound rows, so reusing an id across sections is a constraint
 * violation rather than a clean second message.
 */
let stubId = 0;
(axios as { post: unknown }).post = async (_url: string, payload: { toNumbers: string[]; message: string }) => {
  if (failNext) {
    const err = failNext;
    failNext = null;
    throw err;
  }
  sent.push({ to: payload.toNumbers, body: payload.message });
  return { data: { id: `stub-${++stubId}` } };
};

import { sendAgentSms } from '../src/db/agent-sms';
import { blockNumber, DNC_REASONS } from '../src/db/dnc';
import { getTimeline } from '../src/db/timeline';
import { getLeadDetail } from '../src/db/lead-detail';
import { keepAnswer, startAutomatedCall } from '../src/db/auto-calls';
import { startIncomingCall } from '../src/db/calls';
import { startConversation } from '../src/db/flows';

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

/** A lead mid-flow: answered question 1, waiting on question 2. */
async function makeLeadMidFlow(phone: string): Promise<{ leadId: number; conversationId: number }> {
  const lead = await pool.query(
    `INSERT INTO leads (phone, first_name, source) VALUES ($1, 'Jordan', 'API') RETURNING id`,
    [phone]
  );
  const leadId = lead.rows[0].id;
  // Yes on question 1: on question 2, with 30 points.
  return { leadId, conversationId: await startFlow(leadId, ['1']) };
}

const tookOverAt = async (conversationId: number) =>
  (await pool.query(`SELECT agent_took_over_at FROM conversations WHERE id = $1`, [conversationId]))
    .rows[0].agent_took_over_at;

async function main(): Promise<void> {
  await refuseIfNotEmpty();
  const maya = await makeUser('Maya');

  console.log('\nsending one');
  {
    const { leadId, conversationId } = await makeLeadMidFlow('+15550000601');
    sent = [];

    const res = await sendAgentSms(leadId, maya, 'Hi Jordan, when suits for a call?');

    check('reports success', res.ok, true);
    check('the text went out', sent[0]?.body, 'Hi Jordan, when suits for a call?');
    // sendMessage strips the + before posting; dnc_list keeps E.164.
    check('to the lead', sent[0]?.to, ['15550000601']);
    check('names the agent', res.ok && res.message.agentName, 'Maya');
    check('and reports the take-over', res.ok && res.message.tookOver, true);
    check('the timestamp is set', (await tookOverAt(conversationId)) !== null, true);

    // sent_by is what makes the timeline call it an agent message rather than
    // one of ours.
    const kinds = (await getTimeline(leadId))?.map((e) => e.kind) ?? [];
    check('the timeline calls it an agent message', kinds.includes('agent_sms'), true);
  }

  console.log('\nrule 2b, through the real reply path');
  {
    const { leadId, conversationId } = await makeLeadMidFlow('+15550000602');

    // Before the handoff: a valid answer advances and question 3 goes out.
    const before = await replyAs(leadId, '1');
    check('a reply before the handoff advances', before?.result.conversation.step, 30);
    check('and is scored', before?.result.conversation.score, 45);

    // A second lead, at the same place, whose agent then texts them.
    const taken = await makeLeadMidFlow('+15550000612');
    await sendAgentSms(taken.leadId, maya, 'Hi Jordan, when suits for a call?');

    // After: the same reply does nothing. This is the check the whole task is
    // for - the column written above has to reach the rule.
    const after = await replyAs(taken.leadId, '1');
    check('a reply after the handoff sends nothing', after?.result.send, []);
    check('is not scored', after?.result.conversation.score, 30);
    check('and does not advance', after?.result.conversation.step, 20);

    const row = await pool.query(
      `SELECT c.step, c.score, (SELECT count(*)::int FROM conversation_answers a WHERE a.conversation_id = c.id) AS answers
       FROM conversations c WHERE c.id = $1`,
      [taken.conversationId]
    );
    check('the database agrees: one answer, the one given before', row.rows[0], { step: 20, score: 30, answers: 1 });
    void conversationId;

    // The conversation stays open, so the lead is still reachable and expiry
    // still applies - the agent's callback and disposition track it from here.
    check('the conversation stays open', after?.result.conversation.status, 'open');

    // has_unread_inbound is deliberately not checked here: it is set by the
    // webhook handler, which stores the message and flags the lead before
    // applyReply is ever called. Rule 2b changes nothing about that, and this
    // script drives applyReply directly, so the flag would always read false.
  }

  console.log('\nthe timestamp is set once');
  {
    const { leadId, conversationId } = await makeLeadMidFlow('+15550000603');

    const first = await sendAgentSms(leadId, maya, 'First');
    const at = await tookOverAt(conversationId);

    await new Promise((r) => setTimeout(r, 20));
    const second = await sendAgentSms(leadId, maya, 'Second');

    check('the first send takes over', first.ok && first.message.tookOver, true);
    // The handoff happened on the first message; the tenth should not rewrite it.
    check('the second does not', second.ok && second.message.tookOver, false);
    check('and the timestamp is unchanged', await tookOverAt(conversationId), at);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM messages WHERE lead_id = $1 AND sent_by = $2`,
      [leadId, maya]
    );
    check('both messages are stored', rows[0].n, 2);
  }

  console.log('\na blocked number');
  {
    const { leadId, conversationId } = await makeLeadMidFlow('+15550000604');
    await blockNumber(pool, '+15550000604', DNC_REASONS.smsStop);
    sent = [];

    const res = await sendAgentSms(leadId, maya, 'Hello');

    check('is refused', res.ok === false && res.reason, 'blocked');
    check('nothing is sent', sent.length, 0);
    check('nothing is stored', (await getTimeline(leadId))?.some((e) => e.kind === 'agent_sms'), false);
    // The questions must not stop on the strength of a message never sent.
    check('and no take-over is recorded', await tookOverAt(conversationId), null);
  }

  console.log('\na failed send');
  {
    const { leadId, conversationId } = await makeLeadMidFlow('+15550000605');
    failNext = new Error('upstream 500');

    const res = await sendAgentSms(leadId, maya, 'Hello');

    check('is reported', res.ok === false && res.reason, 'send_failed');
    // Kept, marked failed, so the thread shows it with a red "!" - Jeel,
    // 2026-09-28. Before that nothing was stored at all.
    const kept = (await getTimeline(leadId))?.filter((e) => e.kind === 'agent_sms') ?? [];
    check('is kept in the thread', kept.map((e) => e.detail.body), ['Hello']);
    check('marked failed', kept.map((e) => e.detail.deliveryStatus), ['failed']);
    check('with no EZ Texting id - nothing was accepted', (
      await pool.query(`SELECT ezt_message_id FROM messages WHERE lead_id = $1`, [leadId])
    ).rows.map((r) => r.ezt_message_id), [null]);
    check('and no take-over is recorded', await tookOverAt(conversationId), null);
  }

  console.log('\nan unknown lead');
  {
    sent = [];
    const res = await sendAgentSms(999999, maya, 'Hello');
    check('is rejected', res.ok === false && res.reason, 'lead_not_found');
    check('and nothing is sent', sent.length, 0);
  }

  console.log('\ntexting a lead back returns their missed call');
  {
    const { leadId } = await makeLeadMidFlow('+15550000606');
    await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [leadId, maya]);
    await pool.query(
      `INSERT INTO callbacks (lead_id, agent_id, scheduled_at, reason) VALUES ($1, $2, now(), 'missed_call'), ($1, $2, now() + interval '1 day', 'booked')`,
      [leadId, maya]
    );
    await sendAgentSms(leadId, maya, 'Sorry we missed you - calling shortly.');
    const rows = (await pool.query(`SELECT reason, done_at IS NOT NULL AS done FROM callbacks WHERE lead_id = $1 ORDER BY id`, [leadId])).rows;
    check('the missed call\'s callback is finished; one the agent booked is not', rows, [
      { reason: 'missed_call', done: true },
      { reason: 'booked', done: false },
    ]);
    const log = (await pool.query(`SELECT actor_id, detail->>'because' AS because FROM activity_log WHERE lead_id = $1 AND action = 'callback.done'`, [leadId])).rows;
    check('recorded, with who texted', log, [{ actor_id: maya, because: 'texted_back' }]);
  }

  // Rule 2d - 2026-10-27: a phone call stops the questions too. The lead
  // answered the robot's call, or rang us; their next text is for a person.
  console.log('\na phone call stops the questions (rule 2d)');
  {
    const q1Step = (await pool.query(`SELECT s.id, s.key FROM call_steps s JOIN call_scripts cs ON cs.id = s.script_id WHERE cs.is_active AND s.key = 'q1'`)).rows[0];
    /** A lead whose first question went out and who has not answered it - the leads the robot calls. */
    const waitingOnQ1 = async (phone: string) => {
      const leadId = (await pool.query(`INSERT INTO leads (phone, first_name, source) VALUES ($1, 'Avery', 'API') RETURNING id`, [phone])).rows[0].id;
      await startFlow(leadId, []);
      await pool.query(`UPDATE conversations SET question_sent_at = now() WHERE lead_id = $1`, [leadId]);
      return leadId as number;
    };
    /** The robot's call to the lead, and one answer kept on it, as the webhook keeps it. */
    const robotHeard = async (leadId: number, record: { result: 'choice' | 'unclear' | 'silence'; choiceKey: string | null; choiceLabel: string | null }) => {
      const started = await startAutomatedCall({ leadId, mayRing: () => true });
      if (!started.ok) throw new Error(`the robot's call was refused: ${started.reason}`);
      await keepAnswer({
        callId: started.callId, step: q1Step, attempt: 1, spoken: { heard: record.choiceLabel ?? 'hmm', confidence: 0.9, digits: null },
        record, result: null, blockNumber: false,
      });
    };
    const conversationOf = async (leadId: number) =>
      (await pool.query(`SELECT status, step, score FROM conversations WHERE lead_id = $1 ORDER BY id DESC LIMIT 1`, [leadId])).rows[0];
    const NO = { result: 'choice' as const, choiceKey: '2', choiceLabel: 'No' };

    const answered = await waitingOnQ1('+15550000690');
    await robotHeard(answered, NO);
    const thanks = await replyAs(answered, 'thanks', { stored: true });
    check('answered the robot\'s call, then "thanks": for a person, nothing sent, no "Sorry, please reply 1"', [thanks?.result.needsPerson, thanks?.result.send], [true, []]);
    check('the conversation as it was: on Q1, nothing scored', await conversationOf(answered), { status: 'open', step: 10, score: 0 });
    const one = await replyAs(answered, '1', { stored: true });
    check('nor is a "1" taken for an answer then', [one?.result.needsPerson, one?.result.answer, (await conversationOf(answered)).step], [true, null, 10]);
    const card = await getLeadDetail(answered);
    check('the card says when the call stopped them; no agent did', [card?.conversation?.phoneTookOverAt !== null, card?.conversation?.agentTookOverAt], [true, null]);
    check('the timeline says so', ((await getTimeline(answered)) ?? []).filter((e) => e.detail.event === 'phone_took_over').length, 1);

    const unclear = await waitingOnQ1('+15550000691');
    await robotHeard(unclear, { result: 'unclear', choiceKey: null, choiceLabel: null });
    const unclearOne = await replyAs(unclear, '1', { stored: true });
    check('a call where nothing was understood stops nothing: "1" answers Q1', [unclearOne?.result.needsPerson, (await conversationOf(unclear)).step], [false, 20]);
    check('and the card says no call stopped them', (await getLeadDetail(unclear))?.conversation?.phoneTookOverAt, null);

    const rang = await waitingOnQ1('+15550000692');
    await startIncomingCall({ callSid: 'CA-2C-RANG', fromPhone: '+15550000692' });
    const callMe = await replyAs(rang, 'ok call me at 3', { stored: true });
    check('rang us, then texted "ok call me at 3": for a person, nothing sent', [callMe?.result.needsPerson, callMe?.result.send], [true, []]);

    // A call from before this conversation began does not stop it.
    const before = await waitingOnQ1('+15550000693');
    await startIncomingCall({ callSid: 'CA-2C-BEFORE', fromPhone: '+15550000693' });
    await pool.query(`UPDATE conversations SET status = 'expired' WHERE lead_id = $1`, [before]);
    await startConversation(pool, before, 'open');
    await pool.query(`UPDATE conversations SET question_sent_at = now() WHERE lead_id = $1 AND status = 'open'`, [before]);
    const fresh = await replyAs(before, '1', { stored: true });
    check('a call to an earlier conversation stops nothing in a new one', [fresh?.result.needsPerson, (await conversationOf(before)).step], [false, 20]);

    // Finished first, then rang: the questions were over before the call.
    const finished = (await pool.query(`INSERT INTO leads (phone, first_name, source) VALUES ('+15550000694', 'Avery', 'API') RETURNING id`)).rows[0].id;
    await startFlow(finished, ['1', '1', '2']);
    await startIncomingCall({ callSid: 'CA-2C-AFTER', fromPhone: '+15550000694' });
    check('a lead who finished, then rang: no "stopped by a call" on the card or the timeline', [
      (await getLeadDetail(finished))?.conversation?.phoneTookOverAt,
      ((await getTimeline(finished)) ?? []).some((e) => e.detail.event === 'phone_took_over'),
    ], [null, false]);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
