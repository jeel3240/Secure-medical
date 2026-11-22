/**
 * The new brain on a call (A30): understand, decide, speak behind the real
 * conversation - only OpenAI faked. What the lead hears, and what the call does.
 */
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { ANTIBIOTICS_CALL } from '../core/call-script-fixtures';
import * as logModule from '../lib/log';
import type { Handoff } from './actions';
import { Brain, PREFETCH_SETTLE_MS, RECORD_NOTE, recordFromTurns } from './brain';
import { startState } from './policy';
import { Conversation } from './conversation';
import type { Turn } from './relay-store';
import { FakeClock } from './fake-clock';
import type { WhoIsThere } from './instructions';
import { loadKnowledge } from './knowledge';
import type { SpeakModel, UnderstandModel } from './openai';

/** Thursday 2026-11-12, noon in Arizona. */
const NOW = new Date('2026-11-12T19:00:00Z');
const knowledge = loadKnowledge();

/** OpenAI's understand step, faked: each answer in turn, as JSON. */
class FakeUnderstand implements UnderstandModel {
  answers: (string | Error)[] = [];
  asked: string[] = [];
  /** Never answers - until the request is stopped. */
  hang = false;
  /** The next answer this late - sooner if the request is stopped. */
  slowMs = 0;
  async understand(messages: { content?: unknown }[], _format?: object, signal?: AbortSignal): Promise<string> {
    this.asked.push(String(messages[messages.length - 1].content));
    if (this.hang) return new Promise<string>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('Request was aborted.'))));
    if (this.slowMs > 0) {
      const ms = this.slowMs;
      this.slowMs = 0;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Request was aborted.'));
        });
      });
    }
    const next = this.answers.shift() ?? '{"acts":["other"],"reason":null,"time":null}';
    if (next instanceof Error) throw next;
    return next;
  }
}

/** OpenAI's speak step, faked: each reply in turn - the brief it was given kept. */
class FakeSpeak implements SpeakModel {
  replies: string[] = [];
  briefs: string[] = [];
  messages: { role?: unknown; content?: unknown }[][] = [];
  async *stream(messages: { role?: unknown; content?: unknown }[]): AsyncIterable<string> {
    this.messages.push(messages);
    this.briefs.push(String(messages[messages.length - 1].content));
    const reply = this.replies.shift() ?? '[curious] Anything else?';
    for (const word of reply.split(/(?<= )/)) yield word;
  }
}

const acts = (labels: string[], extra: Record<string, unknown> = {}) => JSON.stringify({ acts: labels, reason: null, time: null, ...extra });

let who: WhoIsThere;
let sent: Record<string, unknown>[];
let kept: Omit<Turn, 'callId'>[];
let ended: Handoff[];
let logged: { event: string; fields: unknown }[];
let understand: FakeUnderstand;
let speak: FakeSpeak;
let conversation: Conversation;

beforeEach(() => {
  who = 'free';
  sent = [];
  kept = [];
  ended = [];
  logged = [];
  understand = new FakeUnderstand();
  speak = new FakeSpeak();
  for (const level of ['info', 'warn', 'error'] as const) {
    jest.spyOn(logModule.log, level).mockImplementation((event: string, fields?: unknown) => {
      logged.push({ event, fields });
    });
  }
  const brain = new Brain(
    { callId: 7, knowledge, lead: { firstName: 'John', phone: '+14805551234' }, now: () => NOW, hours: DEFAULT_CALL_HOURS, callbackNumber: '+14804708259' },
    { understand, speak }
  );
  conversation = new Conversation(
    { callId: 7, greeting: 'Hi, is this John?', hours: DEFAULT_CALL_HOURS, stopLine: ANTIBIOTICS_CALL.optOutBody, optOutWords: ANTIBIOTICS_CALL.optOutWords },
    {
      model: brain,
      whoIsThere: async () => who,
      keep: (turn) => kept.push(turn),
      ended: (handoff) => ended.push(handoff),
      send: (message) => sent.push(JSON.parse(message)),
      now: () => NOW,
      timers: new FakeClock(),
    }
  );
  conversation.start();
});

afterEach(() => jest.restoreAllMocks());

async function until(done: () => boolean, what: string): Promise<void> {
  const by = Date.now() + 2000;
  while (!done()) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

const hers = () => kept.filter((k) => k.who === 'seri').map((k) => k.text);
/** The lead says something, and her reply is kept. */
async function says(words: string): Promise<string> {
  const before = hers().length;
  conversation.heard(words);
  await until(() => hers().length > before || ended.length > 0 || conversation.isOver, 'her reply');
  await new Promise((r) => setTimeout(r, 5));
  return hers()[before] ?? '';
}

describe('the opening', () => {
  it('"Yes." to the greeting: no OpenAI at all - her saved introduction, said by code at once', async () => {
    expect(await says('Yes.')).toBe('This is Seri from eDrugstore, calling about our offer of up to 25% off your first order. Would you like to hear more about it?');
    expect(understand.asked).toEqual([]);
    expect(speak.briefs).toEqual([]);
  });

  it('"Yes. How much is it?": the approved answer, then the saved introduction - both by code, no speak', async () => {
    understand.answers.push(acts(['confirm_identity', 'asks:price']));
    const reply = await says('Yes. How much is it?');
    expect(reply).toBe('Prices depend on the medication and quantity. This is Seri from eDrugstore, calling about our offer of up to 25% off your first order. Would you like to hear more about it?');
    expect(speak.briefs).toEqual([]);
  });

  it('with something speak must word, speak words the introduction too - her question last', async () => {
    understand.answers.push(acts(['confirm_identity', 'asks:uncovered']));
    speak.replies.push("[friendly] That's one for our specialists. [friendly, upbeat] This is Seri from eDrugstore. [curious] Interested?");
    const reply = await says('Yes. Who is your CEO?');
    expect(reply).toBe("That's one for our specialists. This is Seri from eDrugstore. Interested?");
    expect(speak.briefs[0]).toMatch(/\n2\. Say who you are - Seri from eDrugstore/);
  });

  it('"Hello. Hello." later is never the opening again (call 112): she is here, and asks her question again', async () => {
    await says('Yes.');
    understand.answers.push(acts(['checking_line']));
    speak.replies.push("[friendly] Yes, I'm here. [curious] Would that be something you'd like?");
    await says('Hello. Hello.');
    expect(speak.briefs[0]).toMatch(/1\. Say you're here.*\n2\. Come back, briefly and in new words, to your question: whether the offer/s);
  });
});

describe('questions', () => {
  it('an approved answer is said by code, the client\'s words exactly - then speak goes on', async () => {
    await says('Yes.');
    understand.answers.push(acts(['asks:price']));
    speak.replies.push('[curious] Would you like me to connect you with someone now?');
    const reply = await says('How much is it?');
    expect(reply).toBe('Prices depend on the medication and quantity. Would you like me to connect you with someone now?');
    expect(speak.briefs[0]).toContain('You have just said: "Prices depend on the medication and quantity." - don\'t say it again');
    // Speak reads the answer as already said - the lead's question answered, not standing open (calls 118-120).
    expect(speak.messages[0].slice(-3)).toEqual([
      { role: 'user', content: expect.stringContaining('How much is it?') },
      { role: 'assistant', content: 'Prices depend on the medication and quantity.' },
      { role: 'system', content: expect.any(String) },
    ]);
  });

  it('with nobody free the answer leads to a call back, never a person', async () => {
    who = 'nobody';
    await says('Yes.');
    understand.answers.push(acts(['backchannel']));
    await says('Okay.');
    understand.answers.push(acts(['asks:price']));
    await says('How much is it?');
    expect(speak.briefs[1]).toMatch(/Offer a call back.*\nNobody on our team is free right now/s);
  });
});

describe('the actions', () => {
  it('a yes, someone free: an offer to connect; a yes to it - put through, after her last line', async () => {
    await says('Yes.');
    understand.answers.push(acts(['interested']));
    speak.replies.push('[cheerfully] Great! [curious] Would you like me to connect you with someone now?');
    await says("Yes, I'm interested.");
    speak.replies.push('[cheerfully] Great, connecting you now.');
    await says('Yes.');
    await until(() => ended.length === 1, 'the transfer');
    expect(ended).toEqual([{ action: 'transfer_to_agent' }]);
  });

  it('a yes with nobody free: busy and when, never a transfer', async () => {
    who = 'nobody';
    await says('Yes.');
    understand.answers.push(acts(['interested']));
    await says("Yes, I'm interested.");
    expect(speak.briefs[0]).toMatch(/1\. Say plainly that everyone on our team is busy right now\.\n2\. Ask what time/);
    expect(ended).toEqual([]);
  });

  it('a call back: the time worked out by code and said back; "Yes." books it for that time - the call\'s own check agrees', async () => {
    who = 'nobody';
    await says('Yes.');
    understand.answers.push(acts(['wants_callback'], { time: { day: 'tomorrow', hour: 2, minute: null, ampm: null } }));
    speak.replies.push("[curious] So that's tomorrow at 2 PM your time?");
    await says('Call me tomorrow at two.');
    expect(speak.briefs[0]).toContain('"tomorrow at 2 PM your time"');
    speak.replies.push("[cheerfully] You're all set for tomorrow at 2 PM. [friendly] Have a great day!");
    await says('Yes.');
    await until(() => ended.length === 1, 'the booking');
    expect(ended).toEqual([{ action: 'book_callback', at: '2026-11-13T21:00:00.000Z', timeZone: 'America/Phoenix', reason: 'Asked for a call back.' }]);
  });

  it('a last line never asks: a question speak writes in it is not said, and the action is taken (call 95)', async () => {
    await says('Yes.');
    understand.answers.push(acts(['wants_link']));
    speak.replies.push("[friendly] The link is on its way. Anything else? [friendly] Have a great day!");
    const reply = await says('Just text me the link.');
    expect(reply).toBe('The link is on its way. Have a great day!');
    await until(() => ended.length === 1, 'the link');
    expect(ended).toEqual([{ action: 'send_link' }]);
  });

  it('two clear no\'s end the call - nothing more offered', async () => {
    await says('Yes.');
    speak.replies.push("[understanding] No problem. [curious] Is it more the timing, or just not something you need?");
    await says('No.');
    understand.answers.push(JSON.stringify({ acts: ['not_interested'], reason: 'closed', time: null }));
    speak.replies.push('[friendly] Thanks for your time, John. Have a great day.');
    await says("I just don't need it.");
    await until(() => ended.length === 1, 'the goodbye');
    expect(ended).toEqual([{ action: 'end_call', reason: 'not_interested' }]);
  });
});

describe('what the lead heard', () => {
  it('an offer cut off when the lead talked over her was never made - it may be made again', async () => {
    await says('Yes.');
    understand.answers.push(acts(['asks:uncovered']));
    speak.replies.push("[friendly] That's one for our specialists. [curious] Would you like me to connect you with someone now?");
    await says('Who is your CEO?');
    conversation.interrupted("That's one for our specialists.");
    understand.answers.push(acts(['asks:price']));
    await says('How much is it?');
    // The person was never offered: her open question is still the offer itself, not "connect you now?".
    expect(speak.briefs[1]).toContain('to your question: whether the offer is something they would be interested in');
    expect(speak.briefs[1]).not.toContain('whether they would like you to connect them');
  });

  it('the opening talked over is still said - never again (call 114: three times)', async () => {
    await says('Yes.');
    conversation.interrupted('This is Seri from eDrugstore, calling about our offer of up to 25% off your first order. Would you like');
    understand.answers.push(acts(['asks:shipping']));
    await says('Wait. How long does shipping take?');
    expect(speak.briefs[0]).not.toContain('Say who you are');
    understand.answers.push(JSON.stringify({ acts: ['not_interested'], reason: 'closed', time: null }));
    await says('I am not interested.');
    expect(speak.briefs[1]).toContain('Ask, alone and kindly');
  });

  it('a question cut off near its end, and answered, counts as asked (call 114)', async () => {
    await says('Yes.');
    understand.answers.push(JSON.stringify({ acts: ['not_interested'], reason: null, time: null }));
    speak.replies.push('[understanding] Totally fair, John. [curious] Is it more about the timing, or just not something you need right now?');
    await says("I'm not interested.");
    conversation.interrupted('Totally fair, John. Is it more about the timing, or just');
    understand.answers.push(JSON.stringify({ acts: ['not_interested'], reason: 'closed', time: null }));
    speak.replies.push('[friendly] Thanks for your time. Goodbye.');
    await says("I just don't need it.");
    await until(() => ended.length === 1, 'the goodbye');
    // The why was asked: this is the second no, the end - not the why again.
    expect(ended).toEqual([{ action: 'end_call', reason: 'not_interested' }]);
  });

  it('a voicemail greeting: nothing said - the beep decides', async () => {
    understand.answers.push(acts(['machine']));
    conversation.heard('Hi, you have reached John, please leave a message after the tone.');
    await until(() => logged.some((l) => l.event === 'ai_relay.empty_reply'), 'the empty reply');
    expect(speak.briefs).toEqual([]);
    expect(sent.filter((m) => m.type === 'text' && m.token)).toEqual([]);
  });
});

describe('understanding started while the lead still speaks (A33)', () => {
  const opened = async () => {
    await says('Yes.');
  };
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('the same words when they finish: the early answer is used - OpenAI asked once', async () => {
    await opened();
    understand.answers.push(acts(['asks:price']));
    conversation.partial('How much');
    conversation.partial('How much is it?');
    await pause(PREFETCH_SETTLE_MS + 30);
    expect(understand.asked).toHaveLength(1);
    const reply = await says('How much is it?');
    expect(reply).toMatch(/^Prices depend on the medication and quantity\./);
    expect(understand.asked).toHaveLength(1);
    const turn = logged.find((l) => l.event === 'ai_brain.turn' && (l.fields as { understood: string }).understood === 'early')?.fields as Record<string, number>;
    expect(turn).toBeDefined();
    // Measured, never the words: two partials, the last one before the final words, understanding already running.
    expect(turn.partials).toBe(2);
    expect(turn.lastPartialMs).toBeGreaterThanOrEqual(PREFETCH_SETTLE_MS);
    expect(turn.headStartMs).toBeGreaterThanOrEqual(20);
    expect(turn.headStartMs).toBeLessThan(turn.lastPartialMs);
  });

  it('other words when they finish: asked again on the final words - the early answer never used', async () => {
    await opened();
    understand.answers.push(acts(['asks:price']), acts(['asks:shipping']));
    conversation.partial('How much');
    await pause(PREFETCH_SETTLE_MS + 30);
    const reply = await says('How long does shipping take?');
    expect(reply).toMatch(/^Free USPS shipping/);
    expect(understand.asked).toHaveLength(2);
    const turn = logged.filter((l) => l.event === 'ai_brain.turn').pop()?.fields as Record<string, unknown>;
    expect(turn).toMatchObject({ understood: 'openai', partials: 1, headStartMs: null });
  });

  it('words still changing: nothing asked until they settle', async () => {
    await opened();
    conversation.partial('How');
    await pause(PREFETCH_SETTLE_MS / 2);
    conversation.partial('How much');
    await pause(PREFETCH_SETTLE_MS / 2);
    expect(understand.asked).toHaveLength(0);
  });

  it('the lead hanging up while it still runs: stopped with the reply - nothing decided, kept or carried out after the call closed (review H5)', async () => {
    await opened();
    understand.slowMs = 150;
    understand.answers.push(acts(['wants_link']));
    conversation.partial('Just text me the link');
    await pause(PREFETCH_SETTLE_MS + 20);
    const turnsBefore = logged.filter((l) => l.event === 'ai_brain.turn').length;
    conversation.heard('Just text me the link');
    await pause(10);
    conversation.close();
    await pause(250);
    expect(ended).toEqual([]);
    expect(kept.some((k) => k.who === 'action')).toBe(false);
    expect(logged.filter((l) => l.event === 'ai_brain.turn')).toHaveLength(turnsBefore);
  });

  it('a bare yes or no starts nothing - it needs no OpenAI', async () => {
    await opened();
    conversation.partial('Yes.');
    await pause(PREFETCH_SETTLE_MS + 30);
    expect(understand.asked).toHaveLength(0);
  });
});

describe('the call closing while she thinks', () => {
  it('is not OpenAI failing - nothing logged as a failure, no fallback (A34 call 117: the voicemail took the call)', async () => {
    understand.hang = true;
    conversation.heard('Hi, you have reached John. At the tone, please record your message.');
    await new Promise((r) => setTimeout(r, 20));
    conversation.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(logged.some((l) => l.event === 'ai_relay.model_failed')).toBe(false);
    expect(ended).toEqual([]);
  });
});

describe('when OpenAI fails', () => {
  it('the understand step failing: the script takes the call, as when OpenAI fails today (A12)', async () => {
    await says('Yes.');
    understand.answers.push(new Error('OpenAI 500'));
    conversation.heard('How much is it?');
    await until(() => ended.length === 1, 'the fallback');
    expect(ended).toEqual([{ action: 'fallback', why: 'model_failed' }]);
  });

  it('an answer it cannot read: she asks them to say it again', async () => {
    await says('Yes.');
    understand.answers.push('{"acts":["asks:pets"]}');
    await says('Do you sell dog food?');
    expect(speak.briefs[0]).toContain("1. Say you didn't catch that, and ask them to say it again.");
    expect(logged.some((l) => l.event === 'ai_brain.unreadable')).toBe(true);
  });
});

describe('what is kept of each reply (A31)', () => {
  it('a record per reply, never a word said: how it was understood, the acts, the moves, the record before and after', async () => {
    const records: unknown[] = [];
    const brain = new Brain(
      { callId: 8, knowledge, lead: { firstName: 'John', phone: '+14805551234' }, now: () => NOW, hours: DEFAULT_CALL_HOURS, callbackNumber: '+14804708259', keep: (r) => records.push(r) },
      { understand, speak }
    );
    const events: unknown[] = [];
    for await (const e of brain.reply([{ role: 'system', content: 'x' }, { role: 'assistant', content: 'Hi, is this John?' }, { role: 'user', content: '[Who is there: someone free] Yes.' }], new AbortController().signal)) events.push(e);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ version: 1, understood: 'fast', acts: ['confirm_identity'], moves: [{ move: 'opening' }], record: { stage: 'greeting' }, decided: { stage: 'talking', open: 'interest' } });
  });

  it('picked back up: from the last record - the reply after it heard when her turn followed', () => {
    const record = { version: 1, understood: 'fast', acts: [], moves: [{ move: 'opening' }], record: startState(), decided: { ...startState(), stage: 'talking', open: 'interest' } };
    expect(recordFromTurns([])).toBeNull();
    expect(recordFromTurns([{ who: 'lead', text: 'Yes.' }, { who: 'system', text: RECORD_NOTE, data: record }])).toEqual(startState());
    expect(recordFromTurns([{ who: 'system', text: RECORD_NOTE, data: record }, { who: 'seri', text: 'This is Seri.' }])).toEqual(record.decided);
    expect(recordFromTurns([{ who: 'system', text: RECORD_NOTE, data: { ...record, version: 99 } }, { who: 'seri', text: 'x' }])).toBeNull();
    // Kept with the reply already said: an offer counted once, not again.
    const offered = { ...startState(), stage: 'talking' as const, offers: { ...startState().offers, connect: { made: 1, answer: 'none' as const } } };
    const kept = { ...record, moves: [{ move: 'offer', kind: 'connect' }], decided: offered };
    expect(recordFromTurns([{ who: 'system', text: RECORD_NOTE, data: kept }, { who: 'seri', text: 'Shall I connect you?' }])?.offers.connect.made).toBe(1);
  });
});
