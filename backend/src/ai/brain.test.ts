/**
 * The new brain on a call (A30): understand, decide, speak behind the real
 * conversation - only OpenAI faked. What the lead hears, and what the call does.
 */
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { ANTIBIOTICS_CALL } from '../core/call-script-fixtures';
import * as logModule from '../lib/log';
import type { Handoff } from './actions';
import { Brain, RECORD_NOTE, recordFromTurns } from './brain';
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
  async understand(messages: { content?: unknown }[]): Promise<string> {
    this.asked.push(String(messages[messages.length - 1].content));
    const next = this.answers.shift() ?? '{"acts":["other"],"reason":null,"time":null}';
    if (next instanceof Error) throw next;
    return next;
  }
}

/** OpenAI's speak step, faked: each reply in turn - the brief it was given kept. */
class FakeSpeak implements SpeakModel {
  replies: string[] = [];
  briefs: string[] = [];
  async *stream(messages: { content?: unknown }[]): AsyncIterable<string> {
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
    { callId: 7, instructions: 'unused by the brain', greeting: 'Hi, is this John?', hours: DEFAULT_CALL_HOURS, stopLine: ANTIBIOTICS_CALL.optOutBody, optOutWords: ANTIBIOTICS_CALL.optOutWords },
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
  it('"Yes." to the greeting: no OpenAI to understand it - the opening, worded by speak', async () => {
    speak.replies.push("[friendly, upbeat] This is Seri from eDrugstore, calling about our offer of up to 25% off your first order. [curious] Is that something you'd be interested in?");
    expect(await says('Yes.')).toMatch(/^This is Seri from eDrugstore/);
    expect(understand.asked).toEqual([]);
    expect(speak.briefs[0]).toMatch(/1\. Say who you are - Seri from eDrugstore/);
  });

  it('"Hello. Hello." later is never the opening again (call 112): she is here, and asks her question again', async () => {
    speak.replies.push('[friendly, upbeat] This is Seri. [curious] Interested?');
    await says('Yes.');
    understand.answers.push(acts(['checking_line']));
    speak.replies.push("[friendly] Yes, I'm here. [curious] Would that be something you'd like?");
    await says('Hello. Hello.');
    expect(speak.briefs[1]).toMatch(/1\. Say you're here.*\n2\. Come back, briefly and in new words, to your question: whether the offer/s);
  });
});

describe('questions', () => {
  it('an approved answer is said by code, the client\'s words exactly - then speak goes on', async () => {
    speak.replies.push('[friendly, upbeat] This is Seri. [curious] Interested?');
    await says('Yes.');
    understand.answers.push(acts(['asks:price']));
    speak.replies.push('[curious] Would you like me to connect you with someone now?');
    const reply = await says('How much is it?');
    expect(reply).toBe('Prices depend on the medication and quantity. Would you like me to connect you with someone now?');
    expect(speak.briefs[1]).toContain('You have just said: "Prices depend on the medication and quantity." - don\'t say it again');
  });

  it('with nobody free the answer leads to a call back, never a person', async () => {
    who = 'nobody';
    speak.replies.push('[friendly, upbeat] This is Seri. [curious] Interested?');
    await says('Yes.');
    understand.answers.push(acts(['backchannel']));
    await says('Okay.');
    understand.answers.push(acts(['asks:price']));
    await says('How much is it?');
    expect(speak.briefs[2]).toMatch(/Offer a call back.*\nNobody on our team is free right now/s);
  });
});

describe('the actions', () => {
  it('a yes, someone free: an offer to connect; a yes to it - put through, after her last line', async () => {
    speak.replies.push('[friendly, upbeat] This is Seri. [curious] Interested?');
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
    speak.replies.push('[friendly, upbeat] This is Seri. [curious] Interested?');
    await says('Yes.');
    understand.answers.push(acts(['interested']));
    await says("Yes, I'm interested.");
    expect(speak.briefs[1]).toMatch(/1\. Say plainly that everyone on our team is busy right now\.\n2\. Ask what time/);
    expect(ended).toEqual([]);
  });

  it('a call back: the time worked out by code and said back; "Yes." books it for that time - the call\'s own check agrees', async () => {
    who = 'nobody';
    speak.replies.push('[friendly, upbeat] This is Seri. [curious] Interested?');
    await says('Yes.');
    understand.answers.push(acts(['wants_callback'], { time: { day: 'tomorrow', hour: 2, minute: null, ampm: null } }));
    speak.replies.push("[curious] So that's tomorrow at 2 PM your time?");
    await says('Call me tomorrow at two.');
    expect(speak.briefs[1]).toContain('"tomorrow at 2 PM your time"');
    speak.replies.push("[cheerfully] You're all set for tomorrow at 2 PM. [friendly] Have a great day!");
    await says('Yes.');
    await until(() => ended.length === 1, 'the booking');
    expect(ended).toEqual([{ action: 'book_callback', at: '2026-11-13T21:00:00.000Z', timeZone: 'America/Phoenix', reason: 'Asked for a call back.' }]);
  });

  it('a last line never asks: a question speak writes in it is not said, and the action is taken (call 95)', async () => {
    speak.replies.push('[friendly, upbeat] This is Seri. [curious] Interested?');
    await says('Yes.');
    understand.answers.push(acts(['wants_link']));
    speak.replies.push("[friendly] The link is on its way. Anything else? [friendly] Have a great day!");
    const reply = await says('Just text me the link.');
    expect(reply).toBe('The link is on its way. Have a great day!');
    await until(() => ended.length === 1, 'the link');
    expect(ended).toEqual([{ action: 'send_link' }]);
  });

  it('two clear no\'s end the call - nothing more offered', async () => {
    speak.replies.push('[friendly, upbeat] This is Seri. [curious] Interested?');
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
    speak.replies.push('[friendly, upbeat] This is Seri. [curious] Interested?');
    await says('Yes.');
    understand.answers.push(acts(['asks:uncovered']));
    speak.replies.push("[friendly] That's one for our specialists. [curious] Would you like me to connect you with someone now?");
    await says('Who is your CEO?');
    conversation.interrupted("That's one for our specialists.");
    understand.answers.push(acts(['asks:price']));
    await says('How much is it?');
    // The person was never offered: the price leads to the offer to connect.
    expect(speak.briefs[2]).toContain('Offer to connect them with someone on our team now.');
  });

  it('a voicemail greeting: nothing said - the beep decides', async () => {
    understand.answers.push(acts(['machine']));
    conversation.heard('Hi, you have reached John, please leave a message after the tone.');
    await until(() => logged.some((l) => l.event === 'ai_relay.empty_reply'), 'the empty reply');
    expect(speak.briefs).toEqual([]);
    expect(sent.filter((m) => m.type === 'text' && m.token)).toEqual([]);
  });
});

describe('when OpenAI fails', () => {
  it('the understand step failing: the script takes the call, as when OpenAI fails today (A12)', async () => {
    speak.replies.push('[friendly, upbeat] This is Seri. [curious] Interested?');
    await says('Yes.');
    understand.answers.push(new Error('OpenAI 500'));
    conversation.heard('How much is it?');
    await until(() => ended.length === 1, 'the fallback');
    expect(ended).toEqual([{ action: 'fallback', why: 'model_failed' }]);
  });

  it('an answer it cannot read: she asks them to say it again', async () => {
    speak.replies.push('[friendly, upbeat] This is Seri. [curious] Interested?');
    await says('Yes.');
    understand.answers.push('{"acts":["asks:pets"]}');
    await says('Do you sell dog food?');
    expect(speak.briefs[1]).toContain("1. Say you didn't catch that, and ask them to say it again.");
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
