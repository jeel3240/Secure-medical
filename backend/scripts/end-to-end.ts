/**
 * The whole system, end to end: a lead arrives, answers its flow's questions, is
 * scored, reaches the queue, gets worked by an agent, and shows up on the
 * timeline.
 *
 * Phase 3 task 28. This is the script CLAUDE.md §10 asks for, and the closest
 * thing to a rehearsal of a real day before UAT.
 *
 * **What it does not prove.** EZ Texting is stubbed at the HTTP boundary, so
 * every check below holds right up to the moment a text would leave the
 * building - and no further. Nothing here shows that a real phone buzzes. That
 * leg needs a run against the test account, which `docs/README.md`
 * describes. Until then this script proves the machine, not the delivery.
 *
 * Stubbed at `axios.post`, deliberately, not at `sendMessage`: replacing
 * `sendMessage` would take the `dnc_list` check out with it, and the script
 * would certify a compliance guard it had just removed.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE e2e'
 *   DATABASE_URL=postgres://app:app@localhost:5433/e2e node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/e2e REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=weightloss EZT_SEND_GROUP=weightloss \
 *     npx ts-node --transpile-only scripts/end-to-end.ts
 */
import axios from 'axios';

/** Every text the system tried to send, in order. */
const sent: { to: string; body: string }[] = [];
let stubId = 0;

(axios as { post: unknown }).post = async (
  _url: string,
  payload: { toNumbers: string[]; message: string }
) => {
  sent.push({ to: payload.toNumbers[0], body: payload.message });
  return { data: { id: `e2e-${++stubId}` } };
};

import request from 'supertest';
import { openingQuestion, startConversation } from '../src/db/flows';
import { sendOpener } from '../src/worker/opener';
import { pool } from '../src/db/pool';
import { config } from '../src/config';
import { createApp } from '../src/api/app';
import { pgUserStore } from '../src/db/users';
import { listQueue } from '../src/db/queue';
import { getLeadDetail } from '../src/db/lead-detail';
import { getTimeline } from '../src/db/timeline';
import { addNote } from '../src/db/notes';
import { createCallback } from '../src/db/callbacks';
import { setDisposition } from '../src/db/dispositions';
import { claimLead, releaseLead } from '../src/db/claims';
import { markLeadRead } from '../src/db/read-flag';
import { sendAgentSms } from '../src/db/agent-sms';
import { getHealth } from '../src/db/health';

let failures = 0;
let checks = 0;

/**
 * Built on first use rather than at import, so `config` is read after the
 * env is in place. A module-scope `let app` assigned inside main() looked
 * fine and was undefined by the time `reply()` ran.
 */
let cachedApp: ReturnType<typeof createApp> | null = null;
function api() {
  cachedApp ??= createApp({
    users: pgUserStore,
    jwtSecret: config.jwtSecret,
    secureCookies: false,
  });
  return cachedApp;
}

function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`    ok   ${label}`);
  } else {
    failures++;
    console.log(`    FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

function step(title: string): void {
  console.log(`\n${title}`);
}

async function refuseIfNotEmpty(): Promise<void> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM leads`);
  if (rows[0].n > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }
}

/**
 * Drives one inbound reply through the real webhook handler.
 *
 * Built as a supertest request rather than a call to `applyReply`, because the
 * handler does things the state machine does not: it stores the inbound
 * message, dedupes it, and sets `has_unread_inbound`. Calling `applyReply`
 * directly skipped all of that - the first run of this script recorded zero
 * inbound messages and still passed most of its checks, which is exactly the
 * shortcut an end-to-end script exists to catch.
 */
async function reply(phone: string, text: string, receivedAt = new Date()) {
  const res = await request(api())
    .post(`/api/webhooks/eztexting/${config.ezt.webhookToken}`)
    .send({
      type: 'inbound_text.received',
      fromNumber: phone.replace('+', ''),
      toNumber: '15207799209',
      message: text,
      received: receivedAt.toISOString(),
      optIn: false,
      optOut: false,
    });
  return res.status;
}

/** The conversation as it stands, for checking what a reply did. */
async function conversation(leadId: number) {
  const { rows } = await pool.query(
    `SELECT status, step, score, tier FROM conversations WHERE lead_id = $1`,
    [leadId]
  );
  return rows[0];
}

const PHONE = '+15557000001';

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  console.log('End-to-end: one lead, start to finish.');
  console.log('EZ Texting is stubbed - nothing is texted.\n');

  // ---------------------------------------------------------------- the agent
  const agent = (
    await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ('agent@example.com', 'x', 'Rae Whitfield', 'agent') RETURNING id`
    )
  ).rows[0].id;

  // ------------------------------------------------------------- 1. lead in
  step('1. A lead arrives from the partner');
  const leadId: number = (
    await pool.query(
      `INSERT INTO leads (phone, first_name, last_name, source, ezt_added_at)
       VALUES ($1, 'Jordan', 'Miller', 'CORE-G-27', now()) RETURNING id`,
      [PHONE]
    )
  ).rows[0].id;

  // In the flow new leads get, on its first question - as the poller does.
  await startConversation(pool, leadId, 'open');

  // Before the first question has gone out, a text from them is not an answer
  // to it - reply-flow.ts, "a reply before our text".
  await reply(PHONE, 'yes', new Date(Date.now() - 5000));
  check('a text before the first question went out answers nothing', (await conversation(leadId)).score, 0);

  // The first question, sent the way the poller sends it - worker/opener.ts.
  const opener = await sendOpener({ id: leadId, phone: PHONE, firstName: 'Jordan' }, (await openingQuestion(pool, leadId))!);
  check('the first question goes out', [opener.sent, sent.length], [true, 1]);

  check('the lead is stored', leadId > 0, true);
  check('nothing is scored yet', (await getLeadDetail(leadId))?.conversation?.score, 0);
  check('and it is not in the queue', (await listQueue({})).leads.length, 0);

  // ------------------------------------------------------------ 2. the flow
  step('2. The three-question flow');

  check('the webhook accepts the first reply', await reply(PHONE, 'yes'), 200);
  const c1 = await conversation(leadId);
  check('it moves to Q2', c1.step, 20);
  check('and scores replying + Yes', c1.score, 30);

  // A word, not a number: matchAnswer accepts both.
  await reply(PHONE, 'no', new Date(Date.now() + 1000));
  const c2 = await conversation(leadId);
  check('a word answer is understood', c2.step, 30);
  check('and scores that No', c2.score, 35);

  await reply(PHONE, '2', new Date(Date.now() + 2000));
  const c3 = await conversation(leadId);
  check('answering Q3 completes it', c3.status, 'completed');
  check('the score is replying + Yes + No + Talk to an agent + finishing', c3.score, 90);
  check('and the tier is HOT', c3.tier, 'HOT');

  // The first question, then one text per answer - each a reply and, until
  // the last, the next question.
  check('four messages went out', sent.length, 4);
  check('all to the lead', new Set(sent.map((s) => s.to)).size, 1);

  // ------------------------------------------------------------- 3. queue
  step('3. The lead reaches the queue');
  const queue = await listQueue({});
  const queued = queue.leads.find((l) => l.id === leadId);

  check('it is in the queue', queued !== undefined, true);
  check('at the top', queue.leads[0]?.id, leadId);
  check('as HOT', queued?.tier, 'HOT');
  check('with its answers', queued?.answers.map((a) => a.label), ['Yes', 'No', 'Talk to an agent']);
  check('and nobody holds it', queued?.tag?.kind !== 'working', true);

  // ------------------------------------------------------------- 4. claim
  step('4. An agent picks it up');
  const claim = await claimLead(leadId, agent);
  check('the claim succeeds', claim.ok, true);

  const afterClaim = (await listQueue({})).leads.find((l) => l.id === leadId);
  check('the queue shows who has it', afterClaim?.tag?.agentName, 'Rae Whitfield');

  // A second agent must not be able to take it.
  const other = (
    await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ('other@example.com', 'x', 'Sam Okonjo', 'agent') RETURNING id`
    )
  ).rows[0].id;
  const stolen = await claimLead(leadId, other);
  check('a second agent is refused', stolen.ok, false);

  // ------------------------------------------------------- 5. agent works it
  step('5. The agent works the lead');

  const note = await addNote(leadId, agent, 'Spoke briefly, wants a call after 3pm.');
  check('a note is saved', note.ok, true);

  const callback = await createCallback(leadId, agent, new Date(Date.now() + 3600_000));
  check('a callback is booked', callback.ok, true);

  const sms = await sendAgentSms(leadId, agent, 'Hi Jordan, confirming our call this afternoon.');
  check('the agent can text', sms.ok, true);
  // Not a take-over: this conversation already completed, and the take-over
  // timestamp is only set while one is still `open`. There is no automated
  // flow left to stop. A lead taken over mid-flow is covered by
  // scripts/agent-sms-live-check.ts.
  check('no take-over on a finished conversation', sms.ok && sms.message.tookOver, false);

  // Rule 2b: a reply after the handoff is stored but never scored or answered.
  const sentBefore = sent.length;
  await reply(PHONE, '2', new Date(Date.now() + 3000));
  check('a later reply sends nothing', sent.length, sentBefore);
  check('and does not change the score', (await conversation(leadId)).score, 90);

  const disposition = await setDisposition(leadId, agent, 'interested');
  check('a disposition is recorded', disposition.ok, true);

  // --------------------------------------------------------- 6. the timeline
  step('6. The timeline tells the whole story');
  const timeline = (await getTimeline(leadId)) ?? [];
  const kinds = timeline.map((e) => e.kind);

  check('it has entries', timeline.length > 0, true);
  check('the lead arriving is first', timeline[0]?.detail.event, 'lead_received');
  // The first question, and a text for each of the three answers.
  check('the outbound questions are there', kinds.filter((k) => k === 'sms').length, 4);
  // Every text they sent is kept - the one that came before the first question
  // included, though it answered nothing.
  check('so are the replies', kinds.filter((k) => k === 'inbound').length, 5);
  check('the agent SMS is marked as theirs', kinds.includes('agent_sms'), true);
  check('the note is there', kinds.includes('note'), true);
  check('the callback is there', kinds.includes('callback'), true);
  check('and the disposition', kinds.includes('disposition'), true);

  const scored = timeline.find((e) => e.detail.event === 'scored');
  check('the score is shown as an event', scored?.detail.score, 90);

  // ------------------------------------------------------- 7. unread + read
  step('7. An inbound reply is flagged and cleared');
  await pool.query(`UPDATE leads SET has_unread_inbound = true WHERE id = $1`, [leadId]);
  check('the card shows it unread', (await getLeadDetail(leadId))?.flags.unread, true);

  const read = await markLeadRead(leadId);
  check('opening the lead clears it', read.ok, true);
  check('and the card agrees', (await getLeadDetail(leadId))?.flags.unread, false);

  // --------------------------------------------------------- 8. release
  step('8. The agent lets it go');
  const released = await releaseLead(leadId, agent, false);
  check('the release succeeds', released.ok, true);

  const afterRelease = (await listQueue({})).leads.find((l) => l.id === leadId);
  check('the queue frees it', afterRelease?.tag?.kind !== 'working', true);

  // ------------------------------------------------------------- 9. DNC
  step('9. A do-not-call disposition blocks the number');
  const dnc = await setDisposition(leadId, agent, 'dnc');
  check('it is recorded', dnc.ok, true);
  check('and reports the block', dnc.ok && dnc.disposition.blockedNumber, true);

  check('the lead leaves the queue', (await listQueue({})).leads.some((l) => l.id === leadId), false);

  const before = sent.length;
  const refused = await sendAgentSms(leadId, agent, 'One more thing');
  check('texting is refused', refused.ok === false && refused.reason, 'blocked');
  // The compliance guarantee, stated as plainly as it can be: nothing left.
  check('and nothing was sent', sent.length, before);

  // ---------------------------------------------------------- 10. health
  step('10. The system reports on itself');
  const health = await getHealth();
  check('the database check passes', health.checks.find((c) => c.name === 'database')?.status, 'ok');
  // `info`, not `ok`: a webhook check is a number for a human, never an alarm,
  // so it has its own status rather than passing or failing.
  check('the webhook check reports the replies', health.checks.find((c) => c.name === 'webhook')?.status, 'info');
  // The poller has never run here, and the endpoint says so rather than
  // pretending everything is fine.
  check('the poller is honestly reported', health.checks.find((c) => c.name === 'poller')?.status, 'degraded');

  console.log(
    failures === 0
      ? `\nAll ${checks} checks passed.\n\nNot proved: that a real text arrives. EZ Texting was stubbed.`
      : `\n${failures} of ${checks} checks FAILED.`
  );

  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
