/**
 * The whole system, end to end: a lead arrives, answers its flow's questions, is
 * scored, reaches the queue, gets worked by an agent, and shows up on the
 * timeline - and leads who never reply get the robot's call (T25,
 * docs/AUTO-CALLS.md): taken by a person, nobody taking it, and the link. Then
 * Seri, the AI agent, switched on (A20, docs/AI-AGENT.md): the robot holding
 * back while OpenAI is down, and her calls ending each way - a call back, a
 * transfer, the link, a stop, and OpenAI failing mid-call, the script taking
 * over - and the api restarting mid-call, the call picked back up where it was.
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
 * address the previous answer gave - as Twilio follows them. OpenAI is a
 * local server at its HTTP edge (`OPENAI_BASE_URL`), streaming the replies
 * each step scripts; Seri's relay is the real WebSocket on a real server,
 * connected as ConversationRelay connects - signed, then `setup`.
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

import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import twilio from 'twilio';
import WebSocket from 'ws';
import { cachedProbe, fallbackStreak, openAiProbe, seriState } from '../src/ai/health';
import { loadKnowledge } from '../src/ai/knowledge';
import { openAiModel } from '../src/ai/openai';
import { attachRelay } from '../src/ai/relay';
import { pgRelayStore } from '../src/ai/relay-store';
import { readAiAgentOn, switchAiAgent } from '../src/ai/settings';
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
  REFUSED_PAUSE_MINUTES,
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

/** Not a real key: OpenAI here is the local stand-in below. */
const OPENAI_KEY = 'sk-e2e-not-a-real-key';

/**
 * OpenAI, at its HTTP edge (A20): a local server `OPENAI_BASE_URL` points at.
 * Seri's replies are streamed as OpenAI streams them - her words a piece at a
 * time, then her action as a tool call - in the order each step scripts them
 * (`openAiReplies`); `fail` answers one with OpenAI's error. The one-word check
 * the robot makes (A17) is answered up, or down while `openAiDown`.
 */
type ScriptedReply = 'fail' | { say?: string; tool?: { name: string; args?: Record<string, unknown> } };
const openAiReplies: ScriptedReply[] = [];
const openAiAsked: { stream: boolean; messages: { role: string; content?: unknown }[] }[] = [];
let openAiDown = false;

function fakeOpenAi(): http.Server {
  return http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      openAiAsked.push({ stream: body.stream === true, messages: body.messages ?? [] });
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const error = { error: { message: 'The server had an error.', type: 'server_error' } };
      if (!body.stream) {
        if (openAiDown) return json(503, error);
        return json(200, {
          id: 'chatcmpl-check',
          object: 'chat.completion',
          created: 0,
          model: body.model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'length' }],
        });
      }
      const next = openAiReplies.shift() ?? { say: 'Sure.' };
      if (next === 'fail') return json(500, error);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: unknown, finish: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: 'chatcmpl-e2e', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
        );
      // Her words a few at a time, as OpenAI writes them.
      for (const piece of (next.say ?? '').match(/\S+\s*/g) ?? []) chunk({ content: piece });
      if (next.tool) {
        chunk({
          tool_calls: [
            { index: 0, id: 'call_e2e', type: 'function', function: { name: next.tool.name, arguments: JSON.stringify(next.tool.args ?? {}) } },
          ],
        });
      }
      chunk({}, next.tool ? 'tool_calls' : 'stop');
      res.end('data: [DONE]\n\n');
    });
  });
}

/**
 * ConversationRelay's side of a call to Seri: the WebSocket opened as the
 * TwiML says - `url`, signed for it - then `setup` naming our row, and the
 * lead's words as Twilio sends them. Everything the relay sends back is kept.
 */
class Relay {
  received: { type: string; token?: string; last?: boolean; handoffData?: string }[] = [];
  /** The close code, once the relay closed the connection. */
  readonly closed: Promise<number>;
  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => this.received.push(JSON.parse(data.toString())));
    this.closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  }

  /** `reconnect`: Twilio opening it again after the line dropped, its nth time on the call. */
  static async open(port: number, twiml: string, callSid: string, reconnect?: number): Promise<Relay> {
    const url = attribute(twiml, 'ConversationRelay', 'url');
    const call = attribute(twiml, 'Parameter', 'value');
    const ws = new WebSocket(url.replace(TWILIO.publicUrl.replace('https:', 'wss:'), `ws://127.0.0.1:${port}`), {
      headers: { 'X-Twilio-Signature': twilio.getExpectedTwilioSignature(TWILIO.authToken, url, {}) },
    });
    await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
    const relay = new Relay(ws);
    relay.send({
      type: 'setup',
      sessionId: `VX${call}`,
      callSid,
      callType: 'PSTN',
      customParameters: { call },
      ...(reconnect ? { connectionType: 'reconnect', reconnectAttempt: reconnect } : { connectionType: 'initial' }),
    });
    return relay;
  }

  send(message: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message));
  }

  /** What she said, in order. */
  said(): string {
    return this.received
      .filter((m) => m.type === 'text')
      .map((m) => m.token)
      .join('');
  }

  /** The lead speaks; resolves when her reply is over - its closing `last`, or the session's end. */
  async says(words: string): Promise<void> {
    const before = this.received.length;
    this.send({ type: 'prompt', voicePrompt: words, lang: 'en-US', last: true });
    await eventually(
      async () => this.received.slice(before),
      (after) => after.some((m) => m.type === 'end' || (m.type === 'text' && m.last === true))
    );
  }

  /** The `end` the relay sent - her action, as Twilio hands it to the action URL. */
  async ended(): Promise<string> {
    const end = await eventually(
      async () => this.received.find((m) => m.type === 'end'),
      (m) => m !== undefined
    );
    if (!end) throw new Error('the relay never ended the session');
    return end.handoffData ?? '';
  }

  close(): void {
    this.ws.close(1000);
  }
}

/** Tomorrow at 3 PM on a New York clock, as Seri books it: "YYYY-MM-DDTHH:MM". */
function tomorrowAtThreeInNewYork(): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + 86_400_000)
  );
  return `${day}T15:00`;
}

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
    // Seri needs a key; her switch decides whether she takes calls (A13).
    openAiKey: OPENAI_KEY,
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
// Seri's calls (A20).
const DANA = '+15557000005';
const ELI = '+15557000006';
const FRAN = '+15557000007';
const GIL = '+15557000008';
const HAL = '+15557000009';
const IVY = '+15557000010';

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

  console.log('End-to-end: one lead, start to finish; then the robot calls three more, and Seri six.');
  console.log('EZ Texting, Twilio and OpenAI are stubbed - nothing is texted, nothing rings, no AI is asked.\n');

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

  // Switched on three hours ago - leads after it are called first - and, for
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

  // Five calls go out for each person free (T29). Here one, so each lead's
  // story is told on its own - the setting changed as a migration would.
  check('five calls at once for each person free, as migration 021 says', (await dialRoom()).perPerson, 5);
  await pool.query(`UPDATE settings SET value = '1' WHERE key = 'auto_call_calls_per_person'`);

  const look = await dialDueLeads(dialler);
  check('one look: one person free, one call each here - to the lead waiting longest', [look.inside, look.room, look.placed], [true, 1, 1]);
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
    // Fixed ids in letters, never one the stub hands out (CA0...1, CA0...2, ...).
    CallSid: `CA${'c'.repeat(32)}`,
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
  const callBackSid = `CA${'b'.repeat(32)}`;
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

  // ------------------------------------------------ 14. Seri switched on
  step('14. Seri switched on: the robot holds back while OpenAI is down');
  // OpenAI at its HTTP edge, and Seri's relay on a real server, as the API runs it.
  const openAi = fakeOpenAi();
  await new Promise<void>((resolve) => openAi.listen(0, '127.0.0.1', resolve));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(openAi.address() as AddressInfo).port}/v1`;
  /** The api's relay on a server of its own: a fresh one is the api after a restart, with nothing in memory. */
  const startApi = async () => {
    const server = http.createServer(api());
    const relay = attachRelay(server, { twilio: TWILIO, knowledge: loadKnowledge(), store: pgRelayStore(pool), model: openAiModel(OPENAI_KEY) });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, relay, port: (server.address() as AddressInfo).port };
  };
  const { server, relay: seriRelay, port: relayPort } = await startApi();

  check('switched on, as `npm run ai-agent -- on` does, and recorded', (await switchAiAgent(pool, 'on')).changed, true);
  // The worker's look, as worker/index.ts wires it with Seri asked about first
  // (A17) - OpenAI checked on every look here, not once a minute.
  const seriNumbers: AutoCallNumbers = { only: new Set([DANA, ELI, FRAN, GIL, HAL, IVY]), invalid: 0 };
  const seriOnly = [...seriNumbers.only!];
  const seriDialler: DialDeps = {
    ...dialler,
    leadsToCall: (opts) => leadsToCall({ ...opts, only: seriOnly }),
    stillDue: (opts) => stillDue({ ...opts, only: seriOnly }),
    placeAutoCall: (id) => placeAutoCall({ leadId: id, settings: TWILIO, numbers: seriNumbers }),
    seriReady: seriState({
      on: () => readAiAgentOn(pool, OPENAI_KEY),
      paused: () => fallbackStreak(pool, REFUSED_PAUSE_MINUTES),
      probe: cachedProbe(openAiProbe(OPENAI_KEY), { ttlMs: 0 }),
    }),
  };
  /** A lead due for the robot's call, Maya's browser saying it can take one, and the look that calls them. */
  const seriCalls = async (phone: string, first: string) => {
    const id = await silentLead(phone, first, 61);
    await browser.post('/api/calls/ringable').send({ available: true });
    return id;
  };

  const dana = await seriCalls(DANA, 'Dana');
  openAiDown = true;
  const heldBack = await dialDueLeads(seriDialler);
  check('OpenAI not answering its one-word check: nothing placed, and why', [heldBack.stopped, heldBack.aiError, heldBack.placed], [
    'openai_down',
    'OpenAI 503 server_error',
    0,
  ]);
  openAiDown = false;
  check('OpenAI back: the next look calls Dana', (await dialDueLeads(seriDialler)).placed, 1);

  /** One call to Seri: Twilio asks what to do, the verdict says a person, and the relay opens. */
  const answerSeri = async (leadId: number) => {
    const call = await robotCall(leadId);
    const at = (path: string) => `/api/webhooks/twilio/auto/${path}?call=${call.id}`;
    const answered = await twilioAsks(at('answer'), { CallSid: call.sid, CallStatus: 'in-progress' });
    await twilioAsks(at('amd'), { CallSid: call.sid, AnsweredBy: 'human' });
    const relay = await Relay.open(relayPort, answered.twiml, call.sid);
    /** Twilio, once the session has ended: the action URL, then - when the call is over - its end. */
    const after = (params: Record<string, string>) =>
      twilioAsks(attribute(answered.twiml, 'Connect', 'action'), { CallSid: call.sid, CallStatus: 'in-progress', SessionId: `VX${call.id}`, ...params });
    const over = (seconds: number) => twilioAsks(at('status'), { CallSid: call.sid, CallStatus: 'completed', CallDuration: String(seconds) });
    return { call, at, answered, relay, after, over };
  };
  const seriRecord = async (leadId: number) =>
    (await pool.query(`SELECT script_result, ai_ended_with FROM calls WHERE lead_id = $1 AND direction = 'automated'`, [leadId])).rows[0];

  // ------------------------------------------------ 15. a call back
  step('15. Dana talks to Seri, and books a call back');
  const d = await answerSeri(dana);
  check('Twilio is told to connect the call to Seri, greeting Dana by name, friendly', [
    d.answered.twiml.includes('<ConversationRelay'),
    attribute(d.answered.twiml, 'ConversationRelay', 'welcomeGreeting'),
  ], [true, '[friendly] Hi, is this Dana?']);
  openAiReplies.push({ say: "It's Seri from eDrugstore. We have up to 25% off antibiotics today. Is now a good time?" });
  await d.relay.says('Who is this?');
  const firstAsk = openAiAsked.filter((a) => a.stream)[0];
  check('OpenAI is asked with her instructions, her greeting with its tone, and what Dana said', [
    firstAsk?.messages[0]?.role,
    firstAsk?.messages[1]?.content,
    String(firstAsk?.messages[2]?.content).endsWith('Who is this?'),
  ], ['system', '[friendly] Hi, is this Dana?', true]);
  check('she answers, a sentence at a time', d.relay.said(), "It's Seri from eDrugstore. We have up to 25% off antibiotics today. Is now a good time? ");
  openAiReplies.push({
    say: 'No problem, someone will call you tomorrow at 3 PM your time. Have a great day!',
    tool: { name: 'book_callback', args: { time: tomorrowAtThreeInNewYork(), time_zone: 'America/New_York', reason: 'Wants to order antibiotics' } },
  });
  await d.relay.says("I'm driving. Can someone call me tomorrow at 3?");
  const danaHandoff = await d.relay.ended();
  check('her action ends the session, after her last line', JSON.parse(danaHandoff).action, 'book_callback');
  d.relay.close();
  const danaAfter = await d.after({ SessionStatus: 'ended', HandoffData: danaHandoff });
  check('the action URL hangs up - nothing said for her', [danaAfter.twiml.includes('<Hangup/>'), danaAfter.twiml.includes('<Say')], [true, false]);
  await d.over(70);
  check('saved: callback_booked, her part ended with it', await seriRecord(dana), { script_result: 'callback_booked', ai_ended_with: 'book_callback' });
  const danaBooking = (await pool.query(`SELECT agent_id, reason, note FROM callbacks WHERE lead_id = $1`, [dana])).rows;
  check('her call back: nobody\'s yet, with her line for whoever calls', danaBooking, [{ agent_id: null, reason: 'ai_booked', note: 'Wants to order antibiotics' }]);
  check('on Dana\'s page', (await getLeadDetail(dana))?.aiCallback?.note, 'Wants to order antibiotics');
  const danaSeri = ((await getTimeline(dana)) ?? []).find((e) => e.kind === 'call')?.detail.seri as { turns: unknown[]; ended: { action: string } };
  check('on the timeline: her conversation - greeting, two each - and how it ended', [danaSeri?.turns.length, danaSeri?.ended.action], [5, 'book_callback']);
  check('Admin > Leads: Callback booked', (await listAdminLeads({})).leads.find((l) => l.id === dana)?.call, 'callback_booked');
  check('not due yet: not in the queue', (await listQueue({})).leads.some((l) => l.id === dana), false);

  // Tomorrow comes.
  await pool.query(`UPDATE callbacks SET scheduled_at = now() - interval '1 minute' WHERE lead_id = $1`, [dana]);
  const dueRow = (await listQueue({})).leads[0];
  check('due: first in the queue, a callback nobody has, due', [dueRow?.id, dueRow?.tag?.kind, dueRow?.tag?.due, dueRow?.tag?.agentName], [dana, 'callback', true, undefined]);
  check('Maya picks Dana up', (await browser.post(`/api/leads/${dana}/claim`)).status, 200);
  check('the call back is hers now', (await pool.query(`SELECT agent_id FROM callbacks WHERE lead_id = $1`, [dana])).rows[0].agent_id, maya);
  const overdue = (await browser.get('/api/callbacks?when=overdue&tz=America/Phoenix')).body.callbacks as { leadId: number; reason: string }[];
  check('on her My Callbacks', overdue.map((c) => [c.leadId, c.reason]), [[dana, 'ai_booked']]);
  await browser.post(`/api/leads/${dana}/release`);

  // ------------------------------------------------ 16. a transfer
  step('16. Eli wants to order now: Seri puts him through to Maya');
  const eli = await seriCalls(ELI, 'Eli');
  check('the next look calls Eli', (await dialDueLeads(seriDialler)).placed, 1);
  const e = await answerSeri(eli);
  openAiReplies.push({ say: 'Great, connecting you now.', tool: { name: 'transfer_to_agent' } });
  await e.relay.says("Yes, I'd like to order. Can I talk to someone?");
  const eliHandoff = await e.relay.ended();
  e.relay.close();
  const eliAfter = await e.after({ SessionStatus: 'ended', HandoffData: eliHandoff });
  check('Maya\'s browser rings, as a yes to the offer - and nothing she said is said again', [
    eliAfter.twiml.includes(`<Identity>agent-${maya}</Identity>`),
    eliAfter.twiml.includes('<Parameter name="step" value="Offer"/>'),
    eliAfter.twiml.includes('connecting you'),
  ], [true, true, false]);
  const eliTaken = await twilioAsks(attribute(eliAfter.twiml, 'Client', 'url'), {
    CallSid: `CA${'e'.repeat(32)}`,
    ParentCallSid: e.call.sid,
    To: `client:agent-${maya}`,
    CallStatus: 'in-progress',
  });
  check('she accepts: the lead is hers', [eliTaken.status, (await getLeadDetail(eli))?.claimedBy?.name], [200, 'Maya Chen']);
  await twilioAsks(attribute(eliAfter.twiml, 'Dial', 'action'), { CallSid: e.call.sid, CallStatus: 'in-progress', DialCallStatus: 'completed' });
  await e.over(150);
  check('saved: transferred, her part ended with the transfer', await seriRecord(eli), { script_result: 'transferred', ai_ended_with: 'transfer_to_agent' });
  await browser.post(`/api/leads/${eli}/release`);

  // ------------------------------------------------ 17. the link
  step('17. Fran just wants the link');
  const fran = await seriCalls(FRAN, 'Fran');
  check('the next look calls Fran', (await dialDueLeads(seriDialler)).placed, 1);
  const f = await answerSeri(fran);
  openAiReplies.push({ say: "Sure, I'll text you the link now. Have a great day!", tool: { name: 'send_link' } });
  await f.relay.says('Just text me the link, I will look later.');
  const franHandoff = await f.relay.ended();
  f.relay.close();
  await f.after({ SessionStatus: 'ended', HandoffData: franHandoff });
  const toFran = (t: { to: string; body: string }) => t.to === FRAN.slice(1) && t.body.includes('anti-ez');
  await eventually(async () => sent.filter(toFran), (found) => found.length > 0);
  check('the link is texted, once', sent.filter(toFran).length, 1);
  await f.over(40);
  check('saved: link_sent', await seriRecord(fran), { script_result: 'link_sent', ai_ended_with: 'send_link' });

  // ------------------------------------------------ 18. a stop
  step('18. Gil says stop: the number is blocked, whatever she would say');
  const gil = await seriCalls(GIL, 'Gil');
  check('the next look calls Gil', (await dialDueLeads(seriDialler)).placed, 1);
  const g = await answerSeri(gil);
  const askedBefore = openAiAsked.filter((a) => a.stream).length;
  await g.relay.says('Stop calling me.');
  const gilHandoff = await g.relay.ended();
  check('the stop line, and the opt-out - OpenAI never asked', [g.relay.said(), JSON.parse(gilHandoff).action, openAiAsked.filter((a) => a.stream).length], [
    'Okay, we will not call you again. Goodbye.',
    'opt_out',
    askedBefore,
  ]);
  g.relay.close();
  await g.after({ SessionStatus: 'ended', HandoffData: gilHandoff });
  await g.over(15);
  check('saved: opted_out, and the number blocked', [
    (await seriRecord(gil)).script_result,
    (await pool.query(`SELECT reason FROM dnc_list WHERE phone = $1 AND released_at IS NULL`, [GIL])).rows[0]?.reason,
  ], ['opted_out', 'call_opt_out']);

  // ------------------------------------------------ 19. OpenAI fails
  step('19. OpenAI fails on Hal\'s call: the script takes over');
  const hal = await seriCalls(HAL, 'Hal');
  check('the next look calls Hal', (await dialDueLeads(seriDialler)).placed, 1);
  const h = await answerSeri(hal);
  openAiReplies.push('fail');
  await h.relay.says('What is this about?');
  const halHandoff = await h.relay.ended();
  check('her part ends with the fallback, and why', JSON.parse(halHandoff), { action: 'fallback', why: 'model_failed' });
  h.relay.close();
  const halAfter = await h.after({ SessionStatus: 'ended', HandoffData: halHandoff });
  check('sorry, then the script\'s first question - not its greeting', [
    halAfter.twiml.includes('Sorry about that.'),
    halAfter.twiml.includes('Are you interested in ordering?'),
    halAfter.twiml.includes('Hi, this is Seri'),
  ], [true, true, false]);
  const halParams = { CallSid: h.call.sid, CallStatus: 'in-progress' };
  const halNo = await twilioAsks(attribute(halAfter.twiml, 'Gather', 'action'), { ...halParams, SpeechResult: 'No thanks.', Confidence: '0.95' });
  const halNoAgain = await twilioAsks(attribute(halNo.twiml, 'Gather', 'action'), { ...halParams, SpeechResult: 'No.', Confidence: '0.95' });
  check('the script goes on as today: no, then no to the link', halNoAgain.twiml.includes('Thank you for your time'), true);
  await h.over(50);
  check('saved: the script\'s result, and her part a fallback - what the robot counts', await seriRecord(hal), {
    script_result: 'not_interested',
    ai_ended_with: 'fallback',
  });

  // ------------------------------------------------ 20. the api restarts mid-call
  step('20. The api restarts while Ivy talks to Seri: her call is picked back up where it was');
  const ivy = await seriCalls(IVY, 'Ivy');
  check('the next look calls Ivy', (await dialDueLeads(seriDialler)).placed, 1);
  const v = await answerSeri(ivy);
  openAiReplies.push({ say: "This is Seri from eDrugstore, calling about up to 25% off your first order. Is that something you'd be interested in?" });
  await v.relay.says('Who is this?');
  // A deploy: Docker stops the api, which hands each call back to Twilio to reconnect.
  await seriRelay.stop();
  check('the api stopping closes her line with 1012 - Twilio keeps the call and reconnects', await v.relay.closed, 1012);
  server.close();
  const restarted = await startApi();
  // Twilio reconnects to the api that started, then replays what Ivy said meanwhile.
  const v2 = await Relay.open(restarted.port, v.answered.twiml, v.call.sid, 1);
  openAiReplies.push({
    say: 'Perfect, someone will call you tomorrow at 3 PM your time. Have a great day!',
    tool: { name: 'book_callback', args: { time: tomorrowAtThreeInNewYork(), time_zone: 'America/New_York', reason: 'Wants to hear about the offer' } },
  });
  await v2.says('Yes. Can someone call me tomorrow at 3?');
  const ivyHandoff = await v2.ended();
  const afterRestart = openAiAsked.filter((a) => a.stream).at(-1);
  check('OpenAI is asked with the call so far - her greeting, Ivy\'s question, her answer - then what Ivy said after the restart', [
    afterRestart?.messages[1]?.content,
    String(afterRestart?.messages[2]?.content).endsWith('Who is this?'),
    String(afterRestart?.messages[3]?.content).startsWith('This is Seri from eDrugstore'),
    String(afterRestart?.messages.at(-1)?.content).endsWith('Can someone call me tomorrow at 3?'),
  ], ['[friendly] Hi, is this Ivy?', true, true, true]);
  check('no second greeting: the restarted api never said one', v2.said().includes('Hi, is this Ivy?'), false);
  check('her action ends the session, on the new line', JSON.parse(ivyHandoff).action, 'book_callback');
  v2.close();
  const ivyAfter = await v.after({ SessionStatus: 'ended', HandoffData: ivyHandoff });
  check('the action URL hangs up, as on any call', ivyAfter.twiml.includes('<Hangup/>'), true);
  await v.over(95);
  check('saved once: callback_booked, her part ended with it', await seriRecord(ivy), { script_result: 'callback_booked', ai_ended_with: 'book_callback' });
  const ivyActivity = (
    await pool.query(
      `SELECT action, detail FROM activity_log WHERE action LIKE 'ai_agent.%' AND action <> 'ai_agent.switched' AND (detail->>'callId')::int = $1 ORDER BY id`,
      [v.call.id]
    )
  ).rows.map((r) => [r.action, r.detail.attempt ?? r.detail.action ?? null]);
  check('recorded: started once, picked back up once - attempt 1 - and ended once', ivyActivity, [
    ['ai_agent.started', null],
    ['ai_agent.reconnected', 1],
    ['ai_agent.ended', 'book_callback'],
  ]);
  const ivyTurns = (await pool.query(`SELECT who FROM call_ai_turns WHERE call_id = $1 ORDER BY id`, [v.call.id])).rows.map((r) => r.who);
  check('every turn kept, in order, with a note where the line dropped', ivyTurns, ['seri', 'lead', 'seri', 'system', 'lead', 'seri', 'action']);
  const ivySeri = ((await getTimeline(ivy)) ?? []).find((e) => e.kind === 'call')?.detail.seri as { turns: unknown[]; ended: { action: string } };
  check('on the timeline: one conversation, as if nothing happened', [ivySeri?.turns.length, ivySeri?.ended.action], [5, 'book_callback']);

  restarted.server.close();
  openAi.close();

  // ---------------------------------------------------------- 21. health
  step('21. The system reports on itself');
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
      ? `\nAll ${checks} checks passed.\n\nNot proved: that a real text arrives, a real phone rings, or the real model answers as scripted. EZ Texting, Twilio and OpenAI were stubbed.`
      : `\n${failures} of ${checks} checks FAILED.`
  );

  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
