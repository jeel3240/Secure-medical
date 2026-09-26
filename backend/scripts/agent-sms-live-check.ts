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
  const conv = await pool.query(
    `INSERT INTO conversations (lead_id, status, step, q1, score, tier)
     VALUES ($1, 'open', 2, '3', 25, 'LOW') RETURNING id`,
    [leadId]
  );
  return { leadId, conversationId: conv.rows[0].id };
}

const tookOverAt = async (conversationId: number) =>
  (await pool.query(`SELECT agent_took_over_at FROM conversations WHERE id = $1`, [conversationId]))
    .rows[0].agent_took_over_at;

/** Runs a reply through the real reply path, the way the webhook does. */
async function replyAs(leadId: number, phone: string, text: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { applyReply } = require('../src/api/reply-flow') as typeof import('../src/api/reply-flow');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pending = await applyReply(client, leadId, phone, 'Jordan', { text, optOut: false });
    await client.query('COMMIT');
    return pending;
  } finally {
    client.release();
  }
}

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
    const before = await replyAs(leadId, '+15550000602', '1');
    check('a reply before the handoff advances', before?.result.send, 'question_3');
    check('and is scored', before?.result.conversation.score, 55);

    await pool.query(`UPDATE conversations SET step = 2, q2 = NULL, score = 25 WHERE id = $1`, [
      conversationId,
    ]);

    await sendAgentSms(leadId, maya, 'Hi Jordan, when suits for a call?');

    // After: the same reply does nothing. This is the check the whole task is
    // for - the column written above has to reach the rule.
    const after = await replyAs(leadId, '+15550000602', '1');
    check('a reply after the handoff sends nothing', after?.result.send, null);
    check('is not scored', after?.result.conversation.score, 25);
    check('and does not advance', after?.result.conversation.step, 2);

    const row = await pool.query(`SELECT step, q2, score FROM conversations WHERE id = $1`, [
      conversationId,
    ]);
    check('the database agrees', row.rows[0], { step: 2, q2: null, score: 25 });

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
    // Nothing written, so the agent can retry the same text.
    check('nothing is stored', (await getTimeline(leadId))?.some((e) => e.kind === 'agent_sms'), false);
    check('and no take-over is recorded', await tookOverAt(conversationId), null);
  }

  console.log('\nan unknown lead');
  {
    sent = [];
    const res = await sendAgentSms(999999, maya, 'Hello');
    check('is rejected', res.ok === false && res.reason, 'lead_not_found');
    check('and nothing is sent', sent.length, 0);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
