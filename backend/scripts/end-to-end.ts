/**
 * The whole system, end to end: a lead arrives, answers its flow's questions, is
 * scored, reaches the queue, gets worked by an agent, and shows up on the
 * timeline - and leads who never reply get the robot's call (T25,
 * docs/AUTO-CALLS.md): taken by a person, nobody taking it, and the link.
 *
 * Phase 3 task 28. This is the script CLAUDE.md §10 asks for, and the closest
 * thing to a rehearsal of a real day before UAT.
 *
 * **What it does not prove.** EZ Texting and Twilio are stubbed at their HTTP
 * boundaries, so every check below holds right up to the moment a text or a
 * call would leave the building - and no further. Nothing here shows that a
 * real phone buzzes or rings, or that a person hears the call. Those legs need
 * the test account and a real phone, which `docs/README.md` and AUTO-CALLS.md
 * (T26) describe. Until then this script proves the machine, not the delivery.
 *
 * Stubbed at `axios.post`, deliberately, not at `sendMessage`: replacing
 * `sendMessage` would take the `dnc_list` check out with it, and the script
 * would certify a compliance guard it had just removed. Twilio likewise, at
 * its library's one request method (`RequestClient.request`), so what we ask
 * Twilio for - the number, the webhooks, voicemail detection - is built by
 * the real code and checked here. Twilio's side of a call is its webhooks,
 * posted to the real routes and signed as Twilio signs them, each one the
 * address the previous answer gave - as Twilio follows them.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE e2e'
 *   DATABASE_URL=postgres://app:app@localhost:5433/e2e node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/e2e REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=weightloss EZT_SEND_GROUP=weightloss \
 *     npx ts-node --transpile-only scripts/end-to-end.ts
 *
 * It sets the calling hours of that database to every hour of every day, so it
 * passes whenever it is run.
 */
import axios from 'axios';
import RequestClient from 'twilio/lib/base/RequestClient';

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

/** Every request made of Twilio's REST API, in order. */
const twilioAsked: { method: string; uri: string; data: Record<string, unknown> }[] = [];
let twilioCalls = 0;

// Only placing a call is answered: anything else the system asks Twilio for
// here fails the run, so it is noticed rather than answered by accident.
(RequestClient.prototype as { request: unknown }).request = async (opts: {
  method: string;
  uri: string;
  data?: Record<string, unknown>;
}) => {
  const method = opts.method.toUpperCase();
  twilioAsked.push({ method, uri: opts.uri, data: opts.data ?? {} });
  if (method === 'POST' && /\/Calls\.json$/.test(opts.uri)) {
    const sid = `CA${String(++twilioCalls).padStart(32, '0')}`;
    return { statusCode: 201, body: { sid, status: 'queued' }, headers: {} };
  }
  throw new Error(`Twilio was asked for something this script does not answer: ${method} ${opts.uri}`);
};

import request from 'supertest';
import twilio from 'twilio';
import { openingQuestion, startConversation } from '../src/db/flows';
import { sendOpener } from '../src/worker/opener';
import { pool } from '../src/db/pool';
import { config } from '../src/config';
import { createApp } from '../src/api/app';
import { pgUserStore } from '../src/db/users';
import { recordActivity } from '../src/db/activity';
import { hashPassword } from '../src/api/auth/password';
import { listQueue } from '../src/db/queue';
import { listAdminLeads } from '../src/db/leads';
import { getLeadDetail } from '../src/db/lead-detail';
import { getTimeline } from '../src/db/timeline';
import { addNote } from '../src/db/notes';
import { createCallback } from '../src/db/callbacks';
import { setDisposition } from '../src/db/dispositions';
import { claimLead, releaseLead } from '../src/db/claims';
import { markLeadRead } from '../src/db/read-flag';
import { sendAgentSms } from '../src/db/agent-sms';
import { getHealth } from '../src/db/health';
import { finishCall, startCall } from '../src/db/calls';
import { freePeople } from '../src/db/presence';
import { readCallHours } from '../src/db/call-script';
import {
  autoCallsSince,
  closeUnplacedCalls,
  dialRoom,
  leadsToCall,
  recordAutoCallsSwitch,
  stillDue,
  withDialLock,
} from '../src/db/auto-dial';
import { dialDueLeads, type DialDeps } from '../src/worker/auto-calls';
import { placeAutoCall } from '../src/worker/place-auto-call';
import type { AutoCallNumbers } from '../src/auto-calls-settings';
import type { TwilioSettings } from '../src/twilio-settings';

let failures = 0;
let checks = 0;

/**
 * A made-up Twilio account: nothing here reaches Twilio. What matters is that
 * the webhooks are signed with its token and named from its address, as the
 * real ones are. No prefix on the browsers' names, as in production.
 */
const TWILIO: TwilioSettings = {
  accountSid: `AC${'1'.repeat(32)}`,
  authToken: 'e2e-auth-token-not-a-real-one',
  apiKey: `SK${'2'.repeat(32)}`,
  apiSecret: 'e2e-api-secret-not-a-real-one',
  twimlAppSid: `AP${'3'.repeat(32)}`,
  callerId: '+14805550100',
  publicUrl: 'https://e2e.example.com',
  identityPrefix: '',
};

/**
 * Built on first use rather than at import, so `config` is read after the
 * env is in place. A module-scope `let app` assigned inside main() looked
 * fine and was undefined by the time `reply()` ran. Calling set up and
 * automated calls on, as on a server with `AUTO_CALLS=on`.
 */
let cachedApp: ReturnType<typeof createApp> | null = null;
function api() {
  cachedApp ??= createApp({
    users: pgUserStore,
    jwtSecret: config.jwtSecret,
    secureCookies: false,
    twilio: TWILIO,
    autoCalls: true,
    activity: { record: (entry) => recordActivity(pool, entry) },
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

/**
 * Twilio asking one of our webhooks: `address` as a TwiML answer gave it -
 * absolute, `&amp;` and all - signed with the account's token over the full
 * address and the parameters, as Twilio signs.
 */
async function twilioAsks(address: string, params: Record<string, string>): Promise<{ status: number; twiml: string }> {
  const path = address.replace(/&amp;/g, '&').replace(TWILIO.publicUrl, '');
  const signature = twilio.getExpectedTwilioSignature(TWILIO.authToken, TWILIO.publicUrl + path, params);
  const res = await request(api()).post(path).type('form').set('X-Twilio-Signature', signature).send(params);
  return { status: res.status, twiml: res.text };
}

/** An attribute of the first `<tag>` in a TwiML answer - the address Twilio follows next. */
function attribute(twiml: string, tag: string, name: string): string {
  const found = new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]+)"`).exec(twiml);
  if (!found) throw new Error(`No <${tag} ${name}> in: ${twiml}`);
  return found[1];
}

/** Waits for work done after a response has gone - a text sent, a switch turned off. */
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 5000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > until) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The conversation as it stands, for checking what a reply did. */
async function conversation(leadId: number) {
  const { rows } = await pool.query(
    `SELECT status, step, score, tier FROM conversations WHERE lead_id = $1`,
    [leadId]
  );
  return rows[0];
}

/** The robot's call to a lead, as saved. */
async function robotCall(leadId: number) {
  const { rows } = await pool.query(
    `SELECT id, twilio_call_sid AS sid, agent_id, outcome, duration_sec, script_result, answered_by, ended_at
     FROM calls WHERE lead_id = $1 AND direction = 'automated'`,
    [leadId]
  );
  return rows[0];
}

const PHONE = '+15557000001';
const CASEY = '+15557000002';
const RILEY = '+15557000003';
const AVERY = '+15557000004';

/**
 * A lead that came in 70 minutes ago and never answered the first question,
 * sent `textedMinutesAgo` ago - due for the robot's call, an hour after it.
 */
async function silentLead(phone: string, first: string, textedMinutesAgo: number): Promise<number> {
  const id: number = (
    await pool.query(
      `INSERT INTO leads (phone, first_name, last_name, source, ezt_added_at, created_at)
       VALUES ($1, $2, 'Test', 'CORE-G-27', now() - interval '70 minutes', now() - interval '70 minutes') RETURNING id`,
      [phone, first]
    )
  ).rows[0].id;
  await startConversation(pool, id, 'open');
  await sendOpener({ id, phone, firstName: first }, (await openingQuestion(pool, id))!);
  await pool.query(
    `UPDATE conversations SET question_sent_at = now() - ($2 || ' minutes')::interval WHERE lead_id = $1`,
    [id, String(textedMinutesAgo)]
  );
  return id;
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  console.log('End-to-end: one lead, start to finish; then the robot calls three more.');
  console.log('EZ Texting and Twilio are stubbed - nothing is texted and nothing rings.\n');

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

  const scored = timeline.find((e) => e.detail.event === 'scored');
  check('the score is shown as an event', scored?.detail.score, 90);

  // ------------------------------------------------------- 7. unread + read
  step('7. An inbound reply is flagged and cleared');
  await pool.query(`UPDATE leads SET has_unread_inbound = true WHERE id = $1`, [leadId]);
  check('the card shows it unread', (await getLeadDetail(leadId))?.flags.unread, true);

  const read = await markLeadRead(leadId);
  check('opening the lead clears it', read.ok, true);
  check('and the card agrees', (await getLeadDetail(leadId))?.flags.unread, false);

  // ------------------------------------------------- 8. release, then Closed
  step('8. The agent lets it go, then closes it');
  const released = await releaseLead(leadId, agent, false);
  check('the release succeeds', released.ok, true);

  const afterRelease = (await listQueue({})).leads.find((l) => l.id === leadId);
  check('the queue frees it - still there, finished and with a callback', [afterRelease !== undefined, afterRelease?.tag?.kind !== 'working'], [true, true]);

  // Wrap up's outcomes are Closed and DNC (2026-09-28, AGENT-WORKSPACE.md).
  const closed = await setDisposition(leadId, agent, 'closed');
  check('Closed is recorded', closed.ok, true);
  check('the lead leaves the queue', (await listQueue({})).leads.some((l) => l.id === leadId), false);
  check('Admin > Leads reads Closed', (await listAdminLeads({})).leads.find((l) => l.id === leadId)?.status, 'closed');
  const closedCallback = await pool.query(`SELECT done_at IS NOT NULL AS done FROM callbacks WHERE lead_id = $1`, [leadId]);
  check('and its callback is finished with it', closedCallback.rows[0]?.done, true);
  check('the outcome is on the timeline', ((await getTimeline(leadId)) ?? []).some((e) => e.kind === 'disposition'), true);

  // ------------------------------------------------------------- 9. DNC
  step('9. A do-not-call disposition blocks the number');
  const dnc = await setDisposition(leadId, agent, 'dnc');
  check('it is recorded', dnc.ok, true);
  check('and reports the block', dnc.ok && dnc.disposition.blockedNumber, true);

  check('the lead stays out of the queue', (await listQueue({})).leads.some((l) => l.id === leadId), false);

  const before = sent.length;
  const refused = await sendAgentSms(leadId, agent, 'One more thing');
  check('texting is refused', refused.ok === false && refused.reason, 'blocked');
  // The compliance guarantee, stated as plainly as it can be: nothing left.
  check('and nothing was sent', sent.length, before);

  // ------------------------------------------------- 10. the robot is on
  step('10. Automated calls on: the robot calls a lead who never replied');

  // Switched on three hours ago - only leads after it are called - and, for
  // this scratch database, calling at any hour on any day.
  await recordAutoCallsSwitch(true);
  // Written as the robot writes it: UTC, with a Z (`NOW_TEXT`, db/auto-dial.ts).
  await pool.query(
    `UPDATE settings SET value = to_char((now() - interval '3 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     WHERE key = 'auto_calls_since'`
  );
  await pool.query(`UPDATE settings SET value = 'mon,tue,wed,thu,fri,sat,sun' WHERE key = 'auto_call_days'`);
  await pool.query(`UPDATE settings SET value = '00:00' WHERE key = 'auto_call_hours_start'`);
  await pool.query(`UPDATE settings SET value = '23:59' WHERE key = 'auto_call_hours_end'`);

  // Who takes the "yes": an agent who signs in, has the app open, and
  // switches "Taking calls" on - through the routes the browser uses.
  const PASSWORD = 'e2e-password-not-a-real-one';
  const maya: number = (
    await pool.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ('maya@example.com', $1, 'Maya Chen', 'agent') RETURNING id`,
      [await hashPassword(PASSWORD)]
    )
  ).rows[0].id;
  const browser = request.agent(api());
  check('she signs in', (await browser.post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD })).status, 200);
  check('her browser says it can take a call', (await browser.post('/api/calls/ringable').send({ available: true })).status, 200);
  check('she switches Taking calls on', (await browser.post('/api/calls/taking-calls').send({ on: true })).status, 200);
  check('she is free - the only one', await freePeople(pool), [maya]);

  // Three leads who never answered their first text, an hour or more ago.
  const casey = await silentLead(CASEY, 'Casey', 65);
  const riley = await silentLead(RILEY, 'Riley', 63);
  const avery = await silentLead(AVERY, 'Avery', 61);

  // The worker's look, wired as worker/index.ts wires it, with these settings
  // and these test numbers - outside production only test numbers are rung.
  const numbers: AutoCallNumbers = { only: new Set([CASEY, RILEY, AVERY]), invalid: 0 };
  const only = [...numbers.only!];
  const dialler: DialDeps = {
    closeUnplacedCalls,
    autoCallsSince,
    readCallHours: () => readCallHours(pool),
    dialRoom,
    leadsToCall: (opts) => leadsToCall({ ...opts, only }),
    stillDue: (opts) => stillDue({ ...opts, only }),
    placeAutoCall: (id) => placeAutoCall({ leadId: id, settings: TWILIO, numbers }),
    withDialLock,
  };

  const look = await dialDueLeads(dialler);
  check('one look: one person free, so one call - to the lead waiting longest', [look.inside, look.room, look.placed], [true, 1, 1]);
  const placed = twilioAsked[twilioAsked.length - 1];
  const caseyCall = await robotCall(casey);
  check('Twilio is asked to ring Casey, from our number', [placed?.data.To, placed?.data.From], [CASEY, TWILIO.callerId]);
  check('with our webhooks for the call and voicemail detection beside it', [
    placed?.data.Url,
    placed?.data.MachineDetection,
    placed?.data.AsyncAmd,
  ], [`${TWILIO.publicUrl}/api/webhooks/twilio/auto/answer?call=${caseyCall?.id}`, 'DetectMessageEnd', 'true']);
  check('the call is saved, with the call Twilio gave back', [caseyCall?.sid, caseyCall?.agent_id, caseyCall?.script_result], [
    `CA${'1'.padStart(32, '0')}`, null, null,
  ]);
  check('the next look places nothing: that one person may be needed for this call', (await dialDueLeads(dialler)).placed, 0);

  // ---------------------------------------- 11. yes, and a person takes it
  step('11. Casey picks up, says yes, and Maya takes it');
  const caseyAt = (path: string) => `/api/webhooks/twilio/auto/${path}?call=${caseyCall.id}`;
  const callParams = { CallSid: caseyCall.sid, CallStatus: 'in-progress' };

  const answered = await twilioAsks(caseyAt('answer'), callParams);
  check('Twilio asks what to say: the offer, then it listens', [answered.status, answered.twiml.includes('Are you interested in ordering?'), answered.twiml.includes('<Gather')], [200, true, true]);
  check('voicemail detection says a person: nothing changes', (await twilioAsks(caseyAt('amd'), { CallSid: caseyCall.sid, AnsweredBy: 'human' })).status, 204);

  const yes = await twilioAsks(attribute(answered.twiml, 'Gather', 'action'), { ...callParams, SpeechResult: 'Yes, I am.', Confidence: '0.92' });
  check('a yes: "connecting you", then Maya\'s browser rings', [
    yes.twiml.includes('connecting you with a live agent'),
    yes.twiml.includes(`<Identity>agent-${maya}</Identity>`),
  ], [true, true]);

  const taken = await twilioAsks(attribute(yes.twiml, 'Client', 'url'), {
    CallSid: `CA${'9'.padStart(32, '0')}`,
    ParentCallSid: caseyCall.sid,
    To: `client:agent-${maya}`,
    CallStatus: 'in-progress',
  });
  check('she accepts', taken.status, 200);
  check('the lead is hers', (await getLeadDetail(casey))?.claimedBy?.name, 'Maya Chen');
  check('and the call: taken', [(await robotCall(casey)).agent_id, (await robotCall(casey)).script_result], [maya, 'transferred']);
  check('the queue says she is working it', (await listQueue({})).leads.find((l) => l.id === casey)?.tag, {
    kind: 'working', agentId: maya, agentName: 'Maya Chen',
  });

  // They talk; the ring's end, then the call's.
  await twilioAsks(attribute(yes.twiml, 'Dial', 'action'), { ...callParams, DialCallStatus: 'completed', DialCallDuration: '95' });
  check('the call ends', (await twilioAsks(caseyAt('status'), { CallSid: caseyCall.sid, CallStatus: 'completed', CallDuration: '130' })).status, 204);
  const caseyEnded = await robotCall(casey);
  check('saved: answered, by a person, 130 seconds, ended', [caseyEnded.outcome, caseyEnded.answered_by, caseyEnded.duration_sec, caseyEnded.ended_at !== null], [
    'answered', 'human', 130, true,
  ]);
  const caseyLine = ((await getTimeline(casey)) ?? []).find((e) => e.kind === 'call');
  check('the timeline has the call and what Casey said', [caseyLine?.detail.scriptResult, caseyLine?.detail.answers], [
    'transferred',
    [{ question: 'Q1', attempt: 1, heard: 'Yes, I am.', keys: null, result: 'choice', choice: 'Yes' }],
  ]);
  const caseyRow = (await listAdminLeads({})).leads.find((l) => l.id === casey);
  check('Admin > Leads: Working, its call taken', [caseyRow?.status, caseyRow?.call], ['working', 'transferred']);

  // ------------------------------------------ 12. yes, and nobody takes it
  step('12. Riley says yes, and nobody takes it');
  const look2 = await dialDueLeads(dialler);
  check('Maya is free again: the next look calls Riley', look2.placed, 1);
  const rileyCall = await robotCall(riley);
  const rileyAt = (path: string) => `/api/webhooks/twilio/auto/${path}?call=${rileyCall.id}`;
  const rileyParams = { CallSid: rileyCall.sid, CallStatus: 'in-progress' };
  const rileyAnswered = await twilioAsks(rileyAt('answer'), rileyParams);
  const rileyYes = await twilioAsks(attribute(rileyAnswered.twiml, 'Gather', 'action'), { ...rileyParams, Digits: '1' });
  check('a yes - key 1 - rings Maya', rileyYes.twiml.includes(`<Identity>agent-${maya}</Identity>`), true);

  // Maya lets it ring out; nobody is on a call, so nobody is coming.
  const rangOut = await twilioAsks(attribute(rileyYes.twiml, 'Dial', 'action'), { ...rileyParams, DialCallStatus: 'no-answer' });
  check('Riley hears the busy line', rangOut.twiml.includes('An agent will call you back shortly'), true);
  check('the call: a yes nobody took', (await robotCall(riley)).script_result, 'transfer_missed');
  const switchedOff = await eventually(
    async () => (await pool.query(`SELECT taking_calls, taking_calls_why FROM users WHERE id = $1`, [maya])).rows[0],
    (row) => row.taking_calls === false
  );
  check('letting it ring out switched Maya off', [switchedOff.taking_calls, switchedOff.taking_calls_why], [false, 'missed_transfer']);
  await twilioAsks(rileyAt('status'), { CallSid: rileyCall.sid, CallStatus: 'completed', CallDuration: '40' });

  const firstInQueue = (await listQueue({})).leads[0];
  check('Riley is first in the queue, before every scored lead: Wants a call', [firstInQueue?.id, firstInQueue?.tag], [riley, { kind: 'wants_call' }]);
  check('the card says so', (await getLeadDetail(riley))?.flags.missedYes, true);
  check('and Admin > Leads', (await listAdminLeads({})).leads.find((l) => l.id === riley)?.call, 'transfer_missed');

  // Maya picks Riley up and calls them back from the browser.
  await claimLead(riley, maya);
  const callBackSid = `CA${'8'.padStart(32, '0')}`;
  check('Maya calls Riley back', (await startCall({ callSid: callBackSid, leadId: riley, agentId: maya })).ok, true);
  check('someone got back to them: no longer waiting on us', (await getLeadDetail(riley))?.flags.missedYes, false);
  await finishCall({ callSid: callBackSid, outcome: 'answered', durationSec: 60 });
  await releaseLead(riley, maya, false);

  // --------------------------------------------------- 13. the link
  step('13. Avery says no, then yes to the link');
  // Maya switches back on - nobody free, no call.
  check('with nobody free the robot waits', (await dialDueLeads(dialler)).placed, 0);
  await browser.post('/api/calls/taking-calls').send({ on: true });
  check('Maya back on: the next look calls Avery', (await dialDueLeads(dialler)).placed, 1);
  const averyCall = await robotCall(avery);
  const averyAt = (path: string) => `/api/webhooks/twilio/auto/${path}?call=${averyCall.id}`;
  const averyParams = { CallSid: averyCall.sid, CallStatus: 'in-progress' };
  const averyAnswered = await twilioAsks(averyAt('answer'), averyParams);
  const no = await twilioAsks(attribute(averyAnswered.twiml, 'Gather', 'action'), { ...averyParams, SpeechResult: 'No thanks.', Confidence: '0.97' });
  check('a no: the second question', no.twiml.includes('Can we send you a link'), true);
  const linkYes = await twilioAsks(attribute(no.twiml, 'Gather', 'action'), { ...averyParams, SpeechResult: 'Sure, text me.', Confidence: '0.9' });
  check('a yes to it: "check your SMS", and the call ends', [linkYes.twiml.includes('Check your SMS'), linkYes.twiml.includes('<Hangup')], [true, true]);
  // Sent once Twilio has its answer - looked for until it is. EZ Texting
  // takes the number without its "+".
  const toAvery = (s: { to: string; body: string }) => s.to === AVERY.slice(1) && s.body.includes('anti-ez');
  const linkText = await eventually(async () => sent.find(toAvery), (found) => found !== undefined);
  check('the link is texted to Avery, once', [linkText !== undefined, sent.filter(toAvery).length], [true, 1]);
  await twilioAsks(averyAt('status'), { CallSid: averyCall.sid, CallStatus: 'completed', CallDuration: '25' });
  const averyRow = (await listAdminLeads({})).leads.find((l) => l.id === avery);
  check('two tracks at once: still awaiting a text reply, and the link sent', [averyRow?.status, averyRow?.call], ['awaiting_reply', 'link_sent']);
  check('Avery is not in the queue - nothing for an agent to do', (await listQueue({})).leads.some((l) => l.id === avery), false);

  // Avery texts back. Having answered the robot's call, a text is for a
  // person, not an answer to the first question (STATE-MACHINE.md 2d).
  const textsBefore = sent.length;
  check('Avery texts "thanks" - the webhook takes it', await reply(AVERY, 'thanks'), 200);
  check('nothing is sent back - no "Sorry, please reply 1 for Yes or 2 for No"', sent.length, textsBefore);
  check('it waits for a person: Inbound reply', (await listQueue({})).leads.find((l) => l.id === avery)?.tag, { kind: 'inbound_reply' });
  check('the card says a call stopped the questions', (await getLeadDetail(avery))?.conversation?.phoneTookOverAt !== null, true);
  check('Twilio was asked only to place the three calls', twilioAsked.map((r) => r.method), ['POST', 'POST', 'POST']);

  // ---------------------------------------------------------- 14. health
  step('14. The system reports on itself');
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
      ? `\nAll ${checks} checks passed.\n\nNot proved: that a real text arrives or a real phone rings. EZ Texting and Twilio were stubbed.`
      : `\n${failures} of ${checks} checks FAILED.`
  );

  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
