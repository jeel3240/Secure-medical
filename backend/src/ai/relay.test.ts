/**
 * The relay - A10, A11, A12. A real WebSocket on a real server, a fake
 * ConversationRelay on the other end (the messages as A02 recorded them), a
 * fake OpenAI, a fake database and a clock moved by hand: who may connect,
 * which call it is, every turn kept in order, Seri talking - her reply in
 * sentences, an action ending the session, the stop check - and the limits and
 * failures reaching the call. What she says turn by turn is
 * conversation.test.ts; the SQL is scripts/ai-agent-live-check.ts.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import twilio from 'twilio';
import WebSocket from 'ws';
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { ANTIBIOTICS_CALL } from '../core/call-script-fixtures';
import * as logModule from '../lib/log';
import type { Handoff } from './actions';
import { Conversation, type VerdictState } from './conversation';
import { FakeClock } from './fake-clock';
import { CALL_HEADING, type WhoIsThere } from './instructions';
import { loadKnowledge } from './knowledge';
import type { ModelEvent, SeriModel } from './openai';
import { attachRelay, type Relay } from './relay';
import { reconnectedNote, RELAY_PATH } from './relay-messages';
import type { AiCall, CallSettings, RelayStore, ResumeResult, StartResult, Turn } from './relay-store';

const KNOWLEDGE = loadKnowledge();
const STOP = ANTIBIOTICS_CALL.optOutBody;

const TOKEN = 'test-auth-token';
const PUBLIC = 'https://calls.example.test';
const JOHN: AiCall = { callId: 7, leadId: 3, firstName: 'john', phone: '+15550001111' };
const SETUP = { type: 'setup', sessionId: 'VX1', callSid: 'CA1', callType: 'PSTN', customParameters: { call: '7' } };

class FakeStore implements RelayStore {
  started: { callId: number; callSid: string; knowledgeVersion: string }[] = [];
  turns: Turn[] = [];
  result: StartResult = { ok: true, call: JOHN };
  startDelayMs = 0;
  startFails = false;
  saveFails = false;

  async startAiCall(input: { callId: number; callSid: string; knowledgeVersion: string }): Promise<StartResult> {
    this.started.push(input);
    if (this.startDelayMs) await new Promise((r) => setTimeout(r, this.startDelayMs));
    if (this.startFails) throw new Error('database down');
    return this.result;
  }

  /** A reconnect: the call so far, unless a test says otherwise. */
  resumed: ResumeResult = { ok: false, reason: 'not_started' };
  resumes: { callId: number; callSid: string; attempt: number | null }[] = [];
  async resumeAiCall(input: { callId: number; callSid: string; attempt: number | null }): Promise<ResumeResult> {
    this.resumes.push(input);
    return this.resumed;
  }

  /** How long each turn takes to save - a slow database. */
  saveDelayMs = 0;
  async saveTurn(turn: Turn): Promise<void> {
    if (this.saveDelayMs) await new Promise((r) => setTimeout(r, this.saveDelayMs));
    if (this.saveFails) throw new Error('database down');
    this.turns.push(turn);
  }

  settings: CallSettings = { script: ANTIBIOTICS_CALL, hours: DEFAULT_CALL_HOURS };
  async callSettings(): Promise<CallSettings> {
    return this.settings;
  }

  who: WhoIsThere = 'free';
  async whoIsThere(): Promise<WhoIsThere> {
    return this.who;
  }

  endedWith: { callId: number; handoff: Handoff }[] = [];
  async endAiCall(callId: number, handoff: Handoff): Promise<boolean> {
    this.endedWith.push({ callId, handoff });
    return true;
  }

  /** Twilio's verdict (A18): come, unless a test says otherwise. */
  verdictNow: VerdictState = 'in';
  verdictAsked = 0;
  async verdict(): Promise<VerdictState> {
    this.verdictAsked++;
    return this.verdictNow;
  }
}

const text = (t: string): ModelEvent => ({ type: 'text', text: t });
const tool = (name: string, args: Record<string, unknown> = {}): ModelEvent => ({
  type: 'tool',
  call: { id: `call_${name}`, name, arguments: JSON.stringify(args) },
});

/** OpenAI, answering as told: "Sure." unless given replies - or failing, or never answering until stopped. */
class FakeModel implements SeriModel {
  asked: ChatCompletionMessageParam[][] = [];
  replies: ModelEvent[][] = [];
  fail: Error | null = null;
  hang = false;
  async *reply(messages: ChatCompletionMessageParam[], signal: AbortSignal): AsyncIterable<ModelEvent> {
    this.asked.push(messages);
    if (this.fail) throw this.fail;
    if (this.hang) await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    for (const event of this.replies.shift() ?? [text('Sure.')]) {
      await Promise.resolve();
      yield event;
    }
  }
}
let model: FakeModel;

let server: http.Server;
let relay: Relay;
let port: number;
let store: FakeStore;
let clock: FakeClock;
let logged: { level: string; event: string; fields: unknown }[];
const sockets: WebSocket[] = [];

async function start(opts: { setupTimeoutMs?: number } = {}): Promise<void> {
  server = http.createServer((_req, res) => res.writeHead(404).end());
  relay = attachRelay(server, {
    twilio: { authToken: TOKEN, publicUrl: PUBLIC, callerId: '+14805308582' },
    knowledge: KNOWLEDGE,
    store,
    model,
    setupTimeoutMs: opts.setupTimeoutMs,
    timers: clock,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
}

beforeEach(async () => {
  store = new FakeStore();
  model = new FakeModel();
  clock = new FakeClock();
  logged = [];
  for (const level of ['info', 'warn', 'error'] as const) {
    jest.spyOn(logModule.log, level).mockImplementation((event: string, fields?: unknown) => {
      logged.push({ level, event, fields });
    });
  }
  await start();
});

/** Until the relay's side of every connection has closed, so no test sees another's. */
async function stop(): Promise<void> {
  for (const ws of sockets.splice(0)) ws.terminate();
  await until(() => relay.wss.clients.size === 0, 'the relay\'s connections to close');
  await new Promise((r) => server.close(r));
}

afterEach(async () => {
  await stop();
  jest.restoreAllMocks();
});

interface Connection {
  ws: WebSocket;
  /** What the relay sent, parsed. */
  received: unknown[];
  /** The close code, once closed. */
  closed: Promise<number>;
  send: (message: unknown) => void;
}

/**
 * Connects as Twilio would: signed for the `wss://` address of `path` - or
 * for `signFor` when given, or not at all with null. Resolves once open, or
 * with the HTTP status the connection was refused with.
 */
async function connect(path = RELAY_PATH, signFor: string | null = `wss://calls.example.test${path}`): Promise<Connection | number> {
  const headers: Record<string, string> = {};
  if (signFor !== null) headers['X-Twilio-Signature'] = twilio.getExpectedTwilioSignature(TOKEN, signFor, {});
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
  sockets.push(ws);
  const received: unknown[] = [];
  ws.on('message', (data) => received.push(JSON.parse(data.toString())));
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve({ ws, received, closed, send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)) }));
    ws.on('unexpected-response', (_req, res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    ws.on('error', reject);
  });
}

async function connected(): Promise<Connection> {
  const c = await connect();
  if (typeof c === 'number') throw new Error(`refused with ${c}`);
  return c;
}

async function until(done: () => boolean, what: string): Promise<void> {
  const by = Date.now() + 2000;
  while (!done()) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const events = (event: string) => logged.filter((l) => l.event === event).map((l) => l.fields);

/** The session's end has reached the client - it is sent before anything is saved, but may arrive after. */
const gotEnd = (c: Connection) => c.received.some((m) => (m as { type: string }).type === 'end');

describe('a call Seri takes', () => {
  it('setup starts her on the call Twilio names, and her greeting is her first turn', async () => {
    const c = await connected();
    c.send(SETUP);
    await until(() => store.turns.length === 1, 'the greeting');

    expect(store.started).toEqual([{ callId: 7, callSid: 'CA1', knowledgeVersion: KNOWLEDGE.version }]);
    expect(store.turns).toEqual([{ callId: 7, who: 'seri', text: 'Hi, is this John?' }]);
    expect(events('ai_relay.started')).toEqual([{ callId: 7, leadId: 3, callSid: 'CA1' }]);
  });

  it('a lead with no usable name was greeted "Hi there!"', async () => {
    store.result = { ok: true, call: { ...JOHN, firstName: 'TEST123' } };
    const c = await connected();
    c.send(SETUP);
    await until(() => store.turns.length === 1, 'the greeting');
    expect(store.turns[0].text).toBe('Hi there!');
  });

  it('what the lead says gets her reply, and both are kept, in order', async () => {
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Who is this?', lang: 'en', last: true });
    await until(() => store.turns.length === 3 && c.received.length === 2, 'three turns, and her reply');

    expect(c.received).toEqual([
      { type: 'text', token: 'Sure. ', last: false },
      { type: 'text', token: '', last: true },
    ]);
    expect(store.turns.map(({ who, text }) => ({ who, text }))).toEqual([
      { who: 'seri', text: 'Hi, is this John?' },
      { who: 'lead', text: 'Who is this?' },
      { who: 'seri', text: 'Sure.' },
    ]);
    expect(store.turns[1].latencyMs).toBeUndefined();
    expect(store.turns[2].latencyMs).toEqual(expect.any(Number));
    expect(store.turns[2].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('a key, and being talked over, are kept; partial and empty prompts and speaker events are not', async () => {
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'info', name: 'agentSpeaking', value: 'on' });
    c.send({ type: 'interrupt', utteranceUntilInterrupt: 'Hi, is', durationUntilInterruptMs: 900 });
    c.send({ type: 'info', name: 'clientSpeaking', value: 'off' });
    c.send({ type: 'prompt', voicePrompt: 'Who', last: false });
    c.send({ type: 'prompt', voicePrompt: '   ', last: true });
    c.send({ type: 'dtmf', digit: '1' });
    c.send({ type: 'prompt', voicePrompt: 'Who is this?', last: true });
    await until(() => store.turns.length === 5 && c.received.length === 2, 'five turns, and her reply');

    expect(store.turns.map(({ who, text }) => [who, text])).toEqual([
      ['seri', 'Hi, is this John?'],
      ['system', 'Cut off. Heard: "Hi, is"'],
      ['lead', '(pressed 1)'],
      ['lead', 'Who is this?'],
      ['seri', 'Sure.'],
    ]);
    expect(c.received).toHaveLength(2);
  });

  it('Twilio\'s error is kept as a note, and only that one came is logged', async () => {
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'error', description: 'Invalid message received: Who is this?' });
    await until(() => store.turns.length === 2, 'the note');
    expect(store.turns[1]).toEqual({ callId: 7, who: 'system', text: 'Twilio error: Invalid message received: Who is this?' });
    expect(events('ai_relay.twilio_error')).toEqual([{ callId: 7 }]);
  });

  it('messages that come while setup is still being saved wait for it', async () => {
    store.startDelayMs = 40;
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Hello?', last: true });
    await until(() => store.turns.length === 3, 'three turns');
    expect(store.turns.map((t) => t.who)).toEqual(['seri', 'lead', 'seri']);
  });

  it('a second setup on the same connection is ignored: the call goes on', async () => {
    const c = await connected();
    c.send(SETUP);
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Hello?', last: true });
    await until(() => store.turns.length === 3, 'three turns');
    expect(store.started).toHaveLength(1);
    expect(events('ai_relay.second_setup')).toEqual([{ callId: 7 }]);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('what is not a message is ignored: the call goes on', async () => {
    const c = await connected();
    c.send(SETUP);
    c.send('not json');
    c.send({ type: 'prompt', voicePrompt: 'Hello?', last: true });
    await until(() => store.turns.length === 3, 'three turns');
    expect(events('ai_relay.bad_message')).toEqual([{ callId: 7 }]);
  });

  it('a turn that cannot be saved is logged, and the lead still hears her', async () => {
    const c = await connected();
    store.saveFails = true;
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Hello?', last: true });
    await until(() => c.received.length === 2, 'her reply');
    await until(() => events('ai_relay.turn_not_saved').length === 3, 'three failures');
    expect(events('ai_relay.turn_not_saved').map((f) => (f as { who: string }).who)).toEqual(['seri', 'lead', 'seri']);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('closing is logged with how many turns were kept', async () => {
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Bye', last: true });
    await until(() => store.turns.length === 3, 'three turns');
    c.ws.close(1000);
    await until(() => events('ai_relay.closed').length === 1, 'the close');
    // A hang-up: nothing of hers ended, nothing recorded - the action URL's to record (A14).
    expect(events('ai_relay.closed')).toEqual([{ callId: 7, code: 1000, turns: 3, ended: false }]);
    expect(store.endedWith).toEqual([]);
  });

  it('never logs what was said', async () => {
    const c = await connected();
    c.send(SETUP);
    model.replies.push([text('Thanks. Someone from our team can help.')]);
    c.send({ type: 'prompt', voicePrompt: 'My card number is 4111', last: true });
    await until(() => store.turns.length === 3, 'her reply');
    c.send({ type: 'interrupt', utteranceUntilInterrupt: 'Thanks. Someone', durationUntilInterruptMs: 300 });
    await until(() => store.turns.length === 4, 'four turns');
    c.ws.close(1000);
    await until(() => events('ai_relay.closed').length === 1, 'the close');
    const all = JSON.stringify(logged);
    for (const words of ['4111', 'Someone', 'Thanks', 'John', '+1555']) expect(all).not.toContain(words);
  });
});

describe('who may connect', () => {
  it('unsigned: refused before any WebSocket, 403', async () => {
    expect(await connect(RELAY_PATH, null)).toBe(403);
    expect(events('ai_relay.refused')).toEqual([{ reason: 'bad_signature' }]);
  });

  it('signed for the https:// address: refused', async () => {
    expect(await connect(RELAY_PATH, `${PUBLIC}${RELAY_PATH}`)).toBe(403);
  });

  it('signed for another address, or without its query: refused', async () => {
    expect(await connect(RELAY_PATH, 'wss://other.example.test/api/ai/relay')).toBe(403);
    expect(await connect(`${RELAY_PATH}?call=7`, `wss://calls.example.test${RELAY_PATH}`)).toBe(403);
  });

  it('signed with its query: accepted', async () => {
    expect(typeof (await connect(`${RELAY_PATH}?call=7`))).toBe('object');
  });

  it('any other path, even signed: 404', async () => {
    expect(await connect('/api/other')).toBe(404);
    expect(events('ai_relay.refused')).toEqual([{ reason: 'not_found', path: '/api/other' }]);
  });

  it('a call Seri cannot start - already hers, over, another call\'s: closed, nothing kept, nothing said', async () => {
    for (const reason of ['already_started', 'over', 'other_call', 'not_automated', 'no_such_call'] as const) {
      store.result = { ok: false, reason };
      const c = await connected();
      c.send(SETUP);
      c.send({ type: 'prompt', voicePrompt: 'Hello?', last: true });
      expect(await c.closed).toBe(1008);
      expect(c.received).toEqual([]);
    }
    expect(store.turns).toEqual([]);
    expect(events('ai_relay.refused').map((f) => (f as { reason: string }).reason)).toEqual([
      'already_started',
      'over',
      'other_call',
      'not_automated',
      'no_such_call',
    ]);
  });

  it('setup naming no row, or no Twilio call: closed without asking the database', async () => {
    for (const setup of [{ ...SETUP, customParameters: {} }, { ...SETUP, customParameters: { call: 'x' } }, { ...SETUP, callSid: '' }]) {
      const c = await connected();
      c.send(setup);
      expect(await c.closed).toBe(1008);
    }
    expect(store.started).toEqual([]);
  });

  it('anything before setup: closed', async () => {
    const c = await connected();
    c.send({ type: 'prompt', voicePrompt: 'Hello?', last: true });
    c.send(SETUP);
    expect(await c.closed).toBe(1008);
    expect(store.started).toEqual([]);
    expect(events('ai_relay.refused')).toEqual([{ reason: 'no_setup', first: 'prompt' }]);
  });

  it('no setup in time: closed', async () => {
    await stop();
    await start({ setupTimeoutMs: 30 });
    const c = await connected();
    expect(await c.closed).toBe(1008);
    expect(events('ai_relay.refused')).toEqual([{ reason: 'no_setup' }]);
  });

  it('the database failing at setup: closed as a failure', async () => {
    store.startFails = true;
    const c = await connected();
    c.send(SETUP);
    expect(await c.closed).toBe(1011);
    expect(events('ai_relay.failed')).toEqual([{ callId: null, err: expect.stringContaining('database down') }]);
  });
});

describe('Seri talks (A11)', () => {
  it('her instructions are built for this call and lead, and her reply goes out in sentences', async () => {
    store.who = 'coming';
    model.replies.push([text('This is Seri from eDrugstore. '), text('How are you today?')]);
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Who is this?', last: true });
    await until(() => c.received.length === 3, 'her reply');

    const [system, greeting, lead] = model.asked[0];
    expect(system.role).toBe('system');
    expect(system.content).toContain(CALL_HEADING);
    expect(system.content).toContain('John');
    expect(system.content).toContain(STOP);
    expect(greeting).toEqual({ role: 'assistant', content: '[friendly] Hi, is this John?' });
    expect(lead).toEqual({ role: 'user', content: '[Who is there: someone coming] Who is this?' });
    expect(c.received).toEqual([
      { type: 'text', token: 'This is Seri from eDrugstore. ', last: false },
      { type: 'text', token: 'How are you today? ', last: false },
      { type: 'text', token: '', last: true },
    ]);
  });

  it('an action ends the session with its handoffData, straight after her last line', async () => {
    model.replies.push([text('No problem. Thanks for your time, have a great day!'), tool('end_call', { reason: 'not_interested' })]);
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Not interested', last: true });
    await until(() => store.endedWith.length === 1 && gotEnd(c) && events('ai_relay.ended').length === 1, 'the end');

    expect(c.received.slice(-3)).toEqual([
      { type: 'text', token: 'Thanks for your time, have a great day! ', last: false },
      { type: 'text', token: '', last: true },
      { type: 'end', handoffData: '{"action":"end_call","reason":"not_interested"}' },
    ]);
    expect(store.endedWith).toEqual([{ callId: 7, handoff: { action: 'end_call', reason: 'not_interested' } }]);
    expect(store.turns.at(-1)).toEqual({ callId: 7, who: 'action', text: '{"action":"end_call","reason":"not_interested"}' });
    expect(events('ai_relay.ended')).toEqual([{ callId: 7, action: 'end_call', reason: 'not_interested' }]);
  });

  it('"stop calling me" ends the session as an opt-out though OpenAI would answer something else', async () => {
    model.replies.push([text('Sure, happy to help!')]);
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Stop calling me.', last: true });
    await until(() => store.endedWith.length === 1 && store.turns.length === 5 && gotEnd(c), 'the end');
    expect(model.asked).toEqual([]);
    expect(c.received).toEqual([
      { type: 'text', token: STOP, last: true },
      { type: 'end', handoffData: '{"action":"opt_out"}' },
    ]);
    expect(store.turns.map((t) => [t.who, t.text])).toEqual([
      ['seri', 'Hi, is this John?'],
      ['lead', 'Stop calling me.'],
      ['system', 'Stop words heard: opted out.'],
      ['seri', STOP],
      ['action', '{"action":"opt_out"}'],
    ]);
  });

  it('key 9 too', async () => {
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'dtmf', digit: '9' });
    await until(() => store.endedWith.length === 1 && gotEnd(c), 'the end');
    expect(model.asked).toEqual([]);
    expect(store.endedWith[0].handoff).toEqual({ action: 'opt_out' });
    expect(c.received.at(-1)).toEqual({ type: 'end', handoffData: '{"action":"opt_out"}' });
  });

  it('with nobody there, a transfer is refused back to her; she offers a call back instead', async () => {
    store.who = 'nobody';
    model.replies.push([tool('transfer_to_agent')], [text('Everyone is busy right now. When suits you for a call back?')]);
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Put me through', last: true });
    await until(() => c.received.length === 3, 'her second reply');
    expect(c.received.some((m) => (m as { type: string }).type === 'end')).toBe(false);
    expect(model.asked[1].at(-1)).toMatchObject({ role: 'tool', content: expect.stringMatching(/^Nobody can take a call right now/) });
    expect(store.endedWith).toEqual([]);
  });

  it('with someone coming, the transfer goes through', async () => {
    store.who = 'coming';
    model.replies.push([text('Great, connecting you now.'), tool('transfer_to_agent')]);
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Yes, put me through', last: true });
    await until(() => store.endedWith.length === 1 && gotEnd(c), 'the end');
    expect(c.received.at(-1)).toEqual({ type: 'end', handoffData: '{"action":"transfer_to_agent"}' });
  });

  it('no call script active: closed as a failure, and never started', async () => {
    store.settings = { script: null, hours: DEFAULT_CALL_HOURS };
    const c = await connected();
    c.send(SETUP);
    expect(await c.closed).toBe(1011);
    expect(store.started).toEqual([]);
    expect(events('ai_relay.no_script')).toEqual([{ callId: 7 }]);
  });
});

describe('limits and failures (A12)', () => {
  /** Waits until the relay has handled everything sent before a key, by the key's turn being kept. */
  async function handled(c: Connection, digit: string, turns: number): Promise<void> {
    c.send({ type: 'dtmf', digit });
    await until(() => store.turns.length === turns, `the key ${digit}`);
  }

  it('Twilio\'s speaker events count the silence: "are you still there?", then a goodbye, and her part ended', async () => {
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'info', name: 'agentSpeaking', value: 'on' });
    await handled(c, '1', 2);
    clock.advance(60_000);
    expect(c.received).toEqual([]);

    c.send({ type: 'info', name: 'agentSpeaking', value: 'off' });
    await handled(c, '2', 3);
    clock.advance(6_000);
    await until(() => c.received.length === 1, 'the line');
    expect(c.received).toEqual([{ type: 'text', token: 'Hello, are you still there?', last: true }]);
    clock.advance(6_000);
    await until(() => gotEnd(c) && store.endedWith.length === 1 && store.turns.length === 6, 'the end');

    expect(c.received.slice(1)).toEqual([
      { type: 'text', token: 'Sorry I missed you, have a great day.', last: true },
      { type: 'end', handoffData: '{"action":"end_call","reason":"no_response"}' },
    ]);
    expect(store.endedWith).toEqual([{ callId: 7, handoff: { action: 'end_call', reason: 'no_response' } }]);
    expect(store.turns.map((t) => [t.who, t.text])).toEqual([
      ['seri', 'Hi, is this John?'],
      ['lead', '(pressed 1)'],
      ['lead', '(pressed 2)'],
      ['seri', 'Hello, are you still there?'],
      ['seri', 'Sorry I missed you, have a great day.'],
      ['action', '{"action":"end_call","reason":"no_response"}'],
    ]);
  });

  it('the call\'s three minutes count from setup: 20 seconds after, a goodbye and the end', async () => {
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'info', name: 'clientSpeaking', value: 'on' });
    await handled(c, '1', 2);
    clock.advance(3 * 60_000 + 20_000);
    await until(() => gotEnd(c) && store.endedWith.length === 1, 'the end');
    expect(c.received).toEqual([
      { type: 'text', token: 'Thanks so much for your time today. Have a great day!', last: true },
      { type: 'end', handoffData: '{"action":"end_call","reason":"time_limit"}' },
    ]);
  });

  it('OpenAI never answering: "One moment...", then the fallback, recorded', async () => {
    model.hang = true;
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Hello?', last: true });
    await until(() => model.asked.length === 1, 'the request');
    clock.advance(4_000);
    await until(() => c.received.length === 1, 'the filler');
    expect(c.received).toEqual([{ type: 'text', token: 'One moment... ', last: false }]);
    clock.advance(4_000);
    await until(() => gotEnd(c) && store.endedWith.length === 1, 'the end');

    expect(c.received.slice(1)).toEqual([
      { type: 'text', token: '', last: true },
      { type: 'end', handoffData: '{"action":"fallback","why":"model_slow"}' },
    ]);
    expect(store.endedWith).toEqual([{ callId: 7, handoff: { action: 'fallback', why: 'model_slow' } }]);
    await until(() => store.turns.length === 4, 'the turns');
    expect(store.turns.map((t) => [t.who, t.text])).toEqual([
      ['seri', 'Hi, is this John?'],
      ['lead', 'Hello?'],
      ['seri', 'One moment...'],
      ['action', '{"action":"fallback","why":"model_slow"}'],
    ]);
  });

  it('OpenAI failing: the fallback, recorded', async () => {
    model.fail = new Error('openai down');
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Hello?', last: true });
    await until(() => gotEnd(c) && store.endedWith.length === 1, 'the end');
    expect(c.received).toEqual([{ type: 'end', handoffData: '{"action":"fallback","why":"model_failed"}' }]);
    expect(store.endedWith).toEqual([{ callId: 7, handoff: { action: 'fallback', why: 'model_failed' } }]);
  });

  it('the socket failing: her part recorded as a fallback, and the close says it had ended', async () => {
    const c = await connected();
    c.send(SETUP);
    await until(() => store.turns.length === 1, 'the greeting');
    c.send('x'.repeat(70 * 1024));
    expect(await c.closed).toBe(1009);
    await until(() => store.endedWith.length === 1 && events('ai_relay.closed').length === 1, 'the fallback and the close');
    expect(store.endedWith[0].handoff).toEqual({ action: 'fallback', why: 'socket_error' });
    expect(events('ai_relay.socket_error')).toHaveLength(1);
    expect(events('ai_relay.closed')).toEqual([{ callId: 7, code: expect.any(Number), turns: 2, ended: true }]);
  });

  it('the relay failing once she is talking: the session ends with the fallback, not a dropped socket', async () => {
    jest.spyOn(Conversation.prototype, 'heard').mockImplementation(() => {
      throw new Error('boom');
    });
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Hello?', last: true });
    await until(() => gotEnd(c) && store.endedWith.length === 1, 'the end');
    expect(c.received).toEqual([{ type: 'end', handoffData: '{"action":"fallback","why":"relay_failed"}' }]);
    expect(events('ai_relay.failed')).toEqual([{ callId: 7, err: expect.stringContaining('boom') }]);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe('Twilio\'s verdict before an ending action (A18)', () => {
  /** "John isn't available right now." - a voicemail greeting she takes for the wrong person. */
  async function endsOnTheGreeting(): Promise<Connection> {
    model.replies.push([text('Sorry about that, have a great day.'), tool('end_call', { reason: 'wrong_person' })]);
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: "John isn't available right now.", last: true });
    await until(() => store.turns.some((t) => t.who === 'action'), 'her choice');
    return c;
  }
  /** Time passing on a call: the relay asks for the verdict every half second. */
  async function pass(ms: number): Promise<void> {
    for (let waited = 0; waited < ms; waited += 500) {
      const asked = store.verdictAsked;
      clock.advance(500);
      await until(() => store.verdictAsked > asked || gotEnd(c0), 'the next look');
    }
  }
  let c0: Connection;

  it('early - the verdict already in: the end straight after her last line, as before', async () => {
    c0 = await endsOnTheGreeting();
    await until(() => gotEnd(c0) && store.endedWith.length === 1, 'the end');
    expect(store.verdictAsked).toBe(1);
  });

  it('late - a person decided a second on: then the end, and her part recorded', async () => {
    store.verdictNow = 'pending';
    c0 = await endsOnTheGreeting();
    await pass(1_000);
    expect(gotEnd(c0)).toBe(false);
    expect(store.endedWith).toEqual([]);
    store.verdictNow = 'in';
    clock.advance(500);
    await until(() => gotEnd(c0) && store.endedWith.length === 1, 'the end');
    expect(store.endedWith).toEqual([{ callId: 7, handoff: { action: 'end_call', reason: 'wrong_person' } }]);
  });

  it('never - no verdict in 15 seconds: the end all the same', async () => {
    store.verdictNow = 'pending';
    c0 = await endsOnTheGreeting();
    await pass(15_000);
    await until(() => gotEnd(c0) && store.endedWith.length === 1, 'the end');
  });

  it('the greeting\'s beep - the voicemail message took the call: no end, nothing recorded, a note why', async () => {
    store.verdictNow = 'pending';
    c0 = await endsOnTheGreeting();
    await pass(3_000);
    store.verdictNow = 'taken';
    clock.advance(500);
    await until(() => store.turns.at(-1)?.who === 'system', 'the note');
    expect(store.turns.at(-1)?.text).toBe('Not done: a machine answered, and the voicemail message took the call.');
    clock.advance(20_000);
    await new Promise((r) => setTimeout(r, 30));
    expect(gotEnd(c0)).toBe(false);
    expect(store.endedWith).toEqual([]);
  });
});

describe('when the line drops: Twilio reconnects, and the call is picked back up', () => {
  const RECONNECT = { ...SETUP, connectionType: 'reconnect', reconnectAttempt: 1 };
  const SO_FAR: { who: 'seri' | 'lead'; text: string }[] = [
    { who: 'seri', text: 'Hi, is this John?' },
    { who: 'lead', text: 'Yes.' },
    { who: 'seri', text: 'This is Seri from eDrugstore.' },
  ];
  const pickedUp = (over: { turns?: typeof SO_FAR; ended?: Handoff | null } = {}): ResumeResult => ({
    ok: true,
    call: JOHN,
    startedAt: new Date(Date.now() - 30_000),
    turns: over.turns ?? SO_FAR,
    ended: over.ended ?? null,
  });
  const kept = () => store.turns.map(({ who, text }) => ({ who, text }));

  it('picked up where it was: nothing started again, a note, and her next reply follows the call so far', async () => {
    store.resumed = pickedUp();
    const c = await connected();
    c.send(RECONNECT);
    await until(() => store.turns.length === 1, 'the note');
    expect(store.resumes).toEqual([{ callId: 7, callSid: 'CA1', attempt: 1 }]);
    expect(store.started).toEqual([]);
    expect(kept()).toEqual([{ who: 'system', text: reconnectedNote(1) }]);
    expect(c.received).toEqual([]);
    expect(events('ai_relay.resumed')).toEqual([{ callId: 7, leadId: 3, attempt: 1, turns: 3, answering: false }]);

    c.send({ type: 'prompt', voicePrompt: 'How much is it?', last: true });
    await until(() => c.received.length === 2, 'her reply');
    const asked = model.asked[0];
    expect(asked.slice(1)).toEqual([
      { role: 'assistant', content: '[friendly] Hi, is this John?' },
      { role: 'user', content: '[Who is there: someone free] Yes.' },
      { role: 'assistant', content: 'This is Seri from eDrugstore.' },
      { role: 'user', content: '[Who is there: someone free] How much is it?' },
    ]);
  });

  it('what the lead said that she never answered is answered at once', async () => {
    store.resumed = pickedUp({ turns: [...SO_FAR, { who: 'lead', text: 'Who is this?' }] });
    const c = await connected();
    c.send(RECONNECT);
    await until(() => c.received.length === 2, 'her reply');
    expect(model.asked[0].at(-1)).toEqual({ role: 'user', content: '[Who is there: someone free] Who is this?' });
    expect(events('ai_relay.resumed')).toEqual([{ callId: 7, leadId: 3, attempt: 1, turns: 4, answering: true }]);
  });

  it('her action already chosen before it dropped: carried out - the end sent, recorded - and OpenAI never asked', async () => {
    store.resumed = pickedUp({ ended: { action: 'send_link' } });
    const c = await connected();
    c.send(RECONNECT);
    c.send({ type: 'prompt', voicePrompt: 'Hello?', last: true });
    await until(() => gotEnd(c) && store.endedWith.length === 1, 'the end');
    expect(c.received).toEqual([{ type: 'end', handoffData: '{"action":"send_link"}' }]);
    expect(store.endedWith).toEqual([{ callId: 7, handoff: { action: 'send_link' } }]);
    await new Promise((r) => setTimeout(r, 30));
    expect(model.asked).toHaveLength(0);
    expect(kept()).toEqual([{ who: 'system', text: reconnectedNote(1) }]);
    expect(events('ai_relay.resumed')).toEqual([{ callId: 7, leadId: 3, attempt: 1, turns: 3, ended: 'send_link' }]);
    c.ws.close(1000);
    await until(() => events('ai_relay.closed').length === 1, 'the close');
    expect(events('ai_relay.closed')).toEqual([{ callId: 7, code: 1000, turns: 1, ended: true }]);
  });

  it('a call she never took - the line dropped before her first connection got that far: taken now, from her greeting', async () => {
    store.resumed = { ok: false, reason: 'not_started' };
    const c = await connected();
    c.send(RECONNECT);
    await until(() => store.turns.length === 1, 'the greeting');
    expect(store.started).toEqual([{ callId: 7, callSid: 'CA1', knowledgeVersion: KNOWLEDGE.version }]);
    expect(kept()).toEqual([{ who: 'seri', text: 'Hi, is this John?' }]);
  });

  it('a reconnect for a call that is over, or not this call: closed, nothing kept or said', async () => {
    for (const reason of ['over', 'other_call', 'not_automated', 'no_such_call'] as const) {
      store.resumed = { ok: false, reason };
      const c = await connected();
      c.send(RECONNECT);
      expect(await c.closed).toBe(1008);
      expect(c.received).toEqual([]);
    }
    expect(store.turns).toEqual([]);
    expect(store.started).toEqual([]);
    expect(events('ai_relay.refused').map((f) => (f as { reason: string }).reason)).toEqual(['over', 'other_call', 'not_automated', 'no_such_call']);
  });

  it('a first connection for a call already hers is still refused: only a reconnect picks one up', async () => {
    store.result = { ok: false, reason: 'already_started' };
    store.resumed = pickedUp();
    const c = await connected();
    c.send(SETUP);
    expect(await c.closed).toBe(1008);
    expect(store.resumes).toEqual([]);
  });

  it('a reconnect while this api still holds the dropped line: that one is cut, its turns written first, and says nothing more', async () => {
    const first = await connected();
    first.send(SETUP);
    first.send({ type: 'prompt', voicePrompt: 'Yes.', last: true });
    await until(() => store.turns.length === 3, 'the first connection\'s turns');
    const before = first.received.length;

    store.resumed = pickedUp();
    const second = await connected();
    second.send(RECONNECT);
    expect(await first.closed).toBe(1006);
    await until(() => store.resumes.length === 1 && events('ai_relay.resumed').length === 1, 'the pick-up');
    expect(events('ai_relay.replaced')).toEqual([{ callId: 7 }]);

    second.send({ type: 'prompt', voicePrompt: 'Go on.', last: true });
    await until(() => second.received.length === 2, 'her reply on the new line');
    expect(first.received.length).toBe(before);
  });

  it('a reconnect for another Twilio call never cuts the line this api holds', async () => {
    const first = await connected();
    first.send(SETUP);
    await until(() => store.turns.length === 1, 'the greeting');
    store.resumed = { ok: false, reason: 'other_call' };
    const other = await connected();
    other.send({ ...RECONNECT, callSid: 'CA2' });
    expect(await other.closed).toBe(1008);
    first.send({ type: 'prompt', voicePrompt: 'Hello?', last: true });
    await until(() => first.received.length === 2, 'her reply on the first line');
    expect(events('ai_relay.replaced')).toEqual([]);
  });
});

describe('the api stopping - a deploy or a restart', () => {
  it('each call closed with 1012 for Twilio to reconnect, its turns written first; a connection meanwhile is told to try again', async () => {
    store.saveDelayMs = 20;
    const c = await connected();
    c.send(SETUP);
    c.send({ type: 'prompt', voicePrompt: 'Who is this?', last: true });
    await until(() => store.turns.length >= 1, 'the greeting');
    expect(relay.liveCalls()).toBe(1);

    await relay.stop();
    expect(await c.closed).toBe(1012);
    expect(store.turns.map((t) => t.text)).toContain('Who is this?');
    // Her part did not end: the call is picked back up after the restart.
    expect(store.endedWith).toEqual([]);
    expect(await connect()).toBe(503);
    expect(relay.liveCalls()).toBe(0);
  });

  it('what the lead says as the line closes is still kept, for the call picked back up to answer', async () => {
    model.hang = true;
    const c = await connected();
    c.send(SETUP);
    await until(() => store.turns.length === 1, 'the greeting');
    const stopping = relay.stop();
    c.send({ type: 'prompt', voicePrompt: 'Are you there?', last: true });
    await stopping;
    expect(await c.closed).toBe(1012);
    await until(() => store.turns.length === 2, 'the lead\'s words');
    expect(store.turns[1]).toMatchObject({ who: 'lead', text: 'Are you there?' });
    expect(model.asked).toHaveLength(0);
  });

  it('nothing open: stops at once', async () => {
    await relay.stop();
    expect(await connect()).toBe(503);
  });
});
