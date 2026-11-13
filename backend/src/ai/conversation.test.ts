/**
 * One call's conversation with Seri - A11, A12. A fake OpenAI that answers as
 * told, a clock moved by hand, and the messages the relay would send Twilio:
 * sentences as they are whole, the sentence check, being talked over, each
 * action, the stop check; and the limits - silence, three minutes, OpenAI
 * slow, failing or never answering.
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { ANTIBIOTICS_CALL } from '../core/call-script-fixtures';
import * as logModule from '../lib/log';
import type { Handoff } from './actions';
import {
  Conversation,
  FILLER_LINE,
  leadMessage,
  LIMITS,
  STILL_THERE_LINE,
  VERDICT_POLL_MS,
  VERDICT_WAIT_MS,
  VOICEMAIL_TOOK_NOTE,
  WRAP_UP_NOTE,
  type VerdictState,
} from './conversation';
import { FakeClock } from './fake-clock';
import type { WhoIsThere } from './instructions';
import type { ModelEvent, SeriModel } from './openai';
import type { Turn } from './relay-store';
import { checkSentence, SPECIALIST_LINE } from './safety';

/** Thursday 2026-11-12, noon in Arizona: inside the agents' hours. */
const NOW = new Date('2026-11-12T19:00:00Z');
const STOP = ANTIBIOTICS_CALL.optOutBody;

const text = (t: string): ModelEvent => ({ type: 'text', text: t });
const tool = (name: string, args: Record<string, unknown> = {}): ModelEvent => ({
  type: 'tool',
  call: { id: `call_${name}`, name, arguments: JSON.stringify(args) },
});

/** A reply OpenAI gives: its events, and optionally a moment to wait before each. */
type Reply = ModelEvent[] | { events: ModelEvent[]; waitBefore: (i: number) => Promise<void> };

class FakeModel implements SeriModel {
  /** The messages of each request, as sent. */
  asked: ChatCompletionMessageParam[][] = [];
  replies: Reply[] = [];
  fail: Error | null = null;

  async *reply(messages: ChatCompletionMessageParam[], signal: AbortSignal): AsyncIterable<ModelEvent> {
    this.asked.push(messages.map((m) => ({ ...m })));
    if (this.fail) throw this.fail;
    const next = this.replies.shift() ?? [text('Sure.')];
    const { events, waitBefore } = Array.isArray(next) ? { events: next, waitBefore: null } : next;
    for (const [i, event] of events.entries()) {
      if (waitBefore) await waitBefore(i);
      await Promise.resolve();
      if (signal.aborted) throw new Error('aborted');
      yield event;
    }
  }
}

/** A promise opened by hand: for a reply that is still being written. */
function gate(): { wait: () => Promise<void>; open: () => void } {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { wait: () => p, open };
}

let model: FakeModel;
let who: WhoIsThere;
let sent: Record<string, unknown>[];
let kept: Omit<Turn, 'callId'>[];
let ended: Handoff[];
let logged: { event: string; fields: unknown }[];
let clock: FakeClock;
let conversation: Conversation;

beforeEach(() => {
  model = new FakeModel();
  who = 'free';
  sent = [];
  kept = [];
  ended = [];
  logged = [];
  clock = new FakeClock();
  for (const level of ['info', 'warn', 'error'] as const) {
    jest.spyOn(logModule.log, level).mockImplementation((event: string, fields?: unknown) => {
      logged.push({ event, fields });
    });
  }
  conversation = new Conversation(
    {
      callId: 7,
      instructions: 'THE INSTRUCTIONS',
      greeting: 'Hi, is this John?',
      hours: DEFAULT_CALL_HOURS,
      stopLine: STOP,
      optOutWords: ANTIBIOTICS_CALL.optOutWords,
    },
    {
      model,
      whoIsThere: async () => who,
      keep: (turn) => kept.push(turn),
      ended: (handoff) => ended.push(handoff),
      send: (message) => sent.push(JSON.parse(message)),
      now: () => NOW,
      timers: clock,
    }
  );
});

afterEach(() => jest.restoreAllMocks());

async function until(done: () => boolean, what: string): Promise<void> {
  const by = Date.now() + 2000;
  while (!done()) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

/** Waits until nothing more happens for a moment. */
const settle = () => new Promise((r) => setTimeout(r, 30));

const tokens = () => sent.filter((m) => m.type === 'text').map((m) => [m.token, m.last]);
const ends = () => sent.filter((m) => m.type === 'end');
const replyEvents = () => logged.filter((l) => l.event === 'ai_relay.reply').map((l) => l.fields as Record<string, unknown>);

describe('what OpenAI is sent', () => {
  it('the instructions, the greeting Twilio said, then the lead\'s words with who is there', async () => {
    conversation.heard('Who is this?');
    await until(() => model.asked.length === 1, 'the request');
    expect(model.asked[0]).toEqual([
      { role: 'system', content: 'THE INSTRUCTIONS' },
      { role: 'assistant', content: 'Hi, is this John?' },
      { role: 'user', content: '[Who is there: someone free] Who is this?' },
    ]);
  });

  it('who is there is asked again before each reply', async () => {
    conversation.heard('Who is this?');
    await until(() => tokens().length === 2, 'her reply');
    who = 'nobody';
    conversation.heard('Okay');
    await until(() => model.asked.length === 2, 'the second request');
    expect(model.asked[1].slice(-3)).toEqual([
      { role: 'user', content: '[Who is there: someone free] Who is this?' },
      { role: 'assistant', content: 'Sure.' },
      { role: 'user', content: '[Who is there: nobody] Okay' },
    ]);
  });

  it('the lead\'s turn is built as the answer test set builds it', () => {
    expect(leadMessage('coming', 'Yes')).toEqual({ role: 'user', content: '[Who is there: someone coming] Yes' });
  });
});

describe('her reply', () => {
  it('goes out a sentence at a time, as each is whole, then is closed', async () => {
    model.replies.push([text('This is Seri'), text(' from eDrugstore. We'), text("'re calling about"), text(' our offer. Is that okay?')]);
    conversation.heard('Who is this?');
    await until(() => tokens().length === 4, 'the reply');
    expect(tokens()).toEqual([
      ['This is Seri from eDrugstore. ', false],
      ["We're calling about our offer. ", false],
      ['Is that okay? ', false],
      ['', true],
    ]);
    expect(kept).toEqual([
      { who: 'seri', text: "This is Seri from eDrugstore. We're calling about our offer. Is that okay?", latencyMs: expect.any(Number) },
    ]);
    expect(conversation.messages.at(-1)).toEqual({
      role: 'assistant',
      content: "This is Seri from eDrugstore. We're calling about our offer. Is that okay?",
    });
  });

  it('a sentence the check would replace: the specialist line in its place, and the rest of that reply dropped', async () => {
    const risky = 'You should take 500 mg twice a day.';
    const check = checkSentence(risky);
    expect(check.reason).toBe('advice');
    model.replies.push([text('Sure. '), text(`${risky} `), text('Anything else?')]);
    conversation.heard('How should I take it?');
    await until(() => tokens().length === 3, 'the reply');
    expect(tokens()).toEqual([
      ['Sure. ', false],
      [`${SPECIALIST_LINE} `, false],
      ['', true],
    ]);
    expect(kept).toEqual([
      { who: 'seri', text: `Sure. ${SPECIALIST_LINE}`, latencyMs: expect.any(Number) },
      { who: 'system', text: `Replaced (advice, "${check.found}"): ${risky}` },
    ]);
  });

  it('an action in a reply with a replaced sentence waits: the specialist line asked a question', async () => {
    model.replies.push([text('Take two a day. '), tool('end_call', { reason: 'other' })]);
    conversation.heard('How many do I take?');
    await settle();
    expect(ends()).toEqual([]);
    expect(conversation.isOver).toBe(false);
  });

  it('its time is from the lead\'s words to her first sentence', async () => {
    const g = gate();
    model.replies.push({ events: [text('Sure.')], waitBefore: () => g.wait() });
    conversation.heard('Hello?');
    await new Promise((r) => setTimeout(r, 40));
    g.open();
    await until(() => kept.length === 1, 'her turn');
    expect(kept[0].latencyMs).toBeGreaterThanOrEqual(35);
    expect(replyEvents()[0]).toEqual({
      callId: 7,
      who: 'free',
      latencyMs: expect.any(Number),
      firstWordMs: expect.any(Number),
      sentences: 1,
      replaced: false,
      action: null,
      stopped: null,
      filler: false,
    });
  });

  it('a reply with nothing in it is logged', async () => {
    model.replies.push([]);
    conversation.heard('Hello?');
    await until(() => logged.some((l) => l.event === 'ai_relay.empty_reply'), 'the warning');
    expect(sent).toEqual([]);
  });
});

describe('talked over', () => {
  it('while she speaks: the reply stops, and the history keeps only what was heard', async () => {
    const g = gate();
    model.replies.push({ events: [text('This is Seri from eDrugstore. '), text('We are calling about our offer.')], waitBefore: (i) => (i === 1 ? g.wait() : Promise.resolve()) });
    conversation.heard('Who is this?');
    await until(() => tokens().length === 1, 'the first sentence');
    conversation.interrupted('This is Seri');
    g.open();
    await settle();
    expect(tokens()).toEqual([['This is Seri from eDrugstore. ', false]]);
    expect(kept).toEqual([{ who: 'seri', text: 'This is Seri from eDrugstore.', latencyMs: expect.any(Number) }]);
    expect(conversation.messages.at(-1)).toEqual({ role: 'assistant', content: 'This is Seri' });
    expect(replyEvents()[0].stopped).toBe('talked_over');
  });

  it('after her reply was all sent, while Twilio still said it: the history keeps what was heard', async () => {
    model.replies.push([text('This is Seri from eDrugstore. We are calling about our offer.')]);
    conversation.heard('Who is this?');
    await until(() => tokens().length === 3, 'the reply');
    conversation.interrupted('This is Seri from');
    expect(conversation.messages.at(-1)).toEqual({ role: 'assistant', content: 'This is Seri from' });
  });

  it('during the greeting: the greeting in the history is what was heard', () => {
    conversation.interrupted('Hi, is');
    expect(conversation.messages[1]).toEqual({ role: 'assistant', content: 'Hi, is' });
  });

  it('before a word was heard: the history is left as it was', () => {
    conversation.interrupted('');
    expect(conversation.messages[1]).toEqual({ role: 'assistant', content: 'Hi, is this John?' });
  });

  it('the lead says more while she is still thinking: one reply, to all of it', async () => {
    conversation.heard('Hello?');
    conversation.heard('Who is this?');
    await until(() => tokens().length === 2, 'the reply');
    await settle();
    expect(model.asked).toHaveLength(1);
    expect(model.asked[0].at(-1)).toEqual({ role: 'user', content: '[Who is there: someone free] Hello? Who is this?' });
  });

  it('the lead says more once she has started: what she said stands, then their words', async () => {
    const g = gate();
    model.replies.push({ events: [text('Sure. '), text('Anything else?')], waitBefore: (i) => (i === 1 ? g.wait() : Promise.resolve()) });
    conversation.heard('Hello?');
    await until(() => tokens().length === 1, 'the first sentence');
    conversation.heard('Who is this?');
    g.open();
    await until(() => model.asked.length === 2, 'the second request');
    expect(model.asked[1].slice(-3)).toEqual([
      { role: 'user', content: '[Who is there: someone free] Hello?' },
      { role: 'assistant', content: 'Sure.' },
      { role: 'user', content: '[Who is there: someone free] Who is this?' },
    ]);
  });
});

describe('her actions', () => {
  it('taken: her last line, closed, then `end` with the action straight after', async () => {
    model.replies.push([text('Great, connecting you now.'), tool('transfer_to_agent')]);
    conversation.heard('Yes, put me through');
    await until(() => ends().length === 1, 'the end');
    expect(sent).toEqual([
      { type: 'text', token: 'Great, connecting you now. ', last: false },
      { type: 'text', token: '', last: true },
      { type: 'end', handoffData: '{"action":"transfer_to_agent"}' },
    ]);
    expect(kept).toEqual([
      { who: 'seri', text: 'Great, connecting you now.', latencyMs: expect.any(Number) },
      { who: 'action', text: '{"action":"transfer_to_agent"}' },
    ]);
    expect(ended).toEqual([{ action: 'transfer_to_agent' }]);
    expect(conversation.isOver).toBe(true);
  });

  it('once ended, nothing more is asked or said', async () => {
    model.replies.push([text('Bye now.'), tool('end_call', { reason: 'not_interested' })]);
    conversation.heard('Not interested');
    await until(() => conversation.isOver, 'the end');
    const before = sent.length;
    conversation.heard('Wait');
    conversation.pressed('9');
    conversation.interrupted('Bye');
    await settle();
    expect(model.asked).toHaveLength(1);
    expect(sent).toHaveLength(before);
  });

  it('an action with no words: its own last line is said for her', async () => {
    model.replies.push([tool('send_link')]);
    conversation.heard('Just text me the link');
    await until(() => ends().length === 1, 'the end');
    expect(tokens()).toEqual([
      ["I'll text you the link now. Have a great day! ", false],
      ['', true],
    ]);
  });

  it('an opt-out in her own words without the stop line: the stop line after them', async () => {
    model.replies.push([text('Of course, I understand.'), tool('opt_out')]);
    conversation.heard('Please never ring me again');
    await until(() => ends().length === 1, 'the end');
    expect(tokens()).toEqual([
      ['Of course, I understand. ', false],
      [`${STOP} `, false],
      ['', true],
    ]);
  });

  it('a call back at a time inside the hours: booked as checked', async () => {
    model.replies.push([
      text('Perfect, someone will call you tomorrow at 3 PM your time. Have a great day!'),
      tool('book_callback', { time: '2026-11-13T15:00', time_zone: 'America/Phoenix', reason: 'Wants to order' }),
    ]);
    conversation.heard('Yes, that works');
    await until(() => ends().length === 1, 'the end');
    expect(ended).toEqual([{ action: 'book_callback', at: '2026-11-13T22:00:00.000Z', timeZone: 'America/Phoenix', reason: 'Wants to order' }]);
  });

  it('with nobody there, a transfer is refused back to her, and she speaks again at once', async () => {
    who = 'nobody';
    model.replies.push([tool('transfer_to_agent')], [text('Everyone is busy right now. What time works for a call back?')]);
    conversation.heard('Put me through to someone');
    await until(() => model.asked.length === 2 && tokens().length === 3, 'her second reply');
    const told = model.asked[1].slice(-2);
    expect(told[0]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_transfer_to_agent', type: 'function', function: { name: 'transfer_to_agent', arguments: '{}' } }],
    });
    expect(told[1]).toMatchObject({ role: 'tool', tool_call_id: 'call_transfer_to_agent', content: expect.stringMatching(/^Nobody can take a call right now/) });
    expect(ends()).toEqual([]);
    expect(kept.map((t) => t.who)).toEqual(['system', 'seri']);
    expect(kept[0].text).toMatch(/^Not done: transfer_to_agent\. Nobody can take a call/);
  });

  it('with someone coming, the transfer goes through - the hold line is the transfer\'s', async () => {
    who = 'coming';
    model.replies.push([text('Great, connecting you now.'), tool('transfer_to_agent')]);
    conversation.heard('Yes please');
    await until(() => ends().length === 1, 'the end');
    expect(ended).toEqual([{ action: 'transfer_to_agent' }]);
  });

  it('refused twice in a row: she waits for the lead', async () => {
    who = 'nobody';
    model.replies.push([tool('transfer_to_agent')], [tool('transfer_to_agent')], [text('never asked')]);
    conversation.heard('Transfer me');
    await until(() => model.asked.length === 2, 'the second try');
    await settle();
    expect(model.asked).toHaveLength(2);
    expect(ends()).toEqual([]);
  });

  it('after a question in the same reply: held back, and the call goes on with the lead\'s answer', async () => {
    model.replies.push([text('Would you like me to connect you now?'), tool('transfer_to_agent')]);
    conversation.heard('I want to order');
    await until(() => tokens().length === 2, 'the question');
    await settle();
    expect(model.asked).toHaveLength(1);
    expect(ends()).toEqual([]);
    conversation.heard('Yes');
    await until(() => model.asked.length === 2, 'the next request');
    expect(model.asked[1].slice(-3).map((m) => m.role)).toEqual(['assistant', 'tool', 'user']);
    expect(model.asked[1].at(-3)).toMatchObject({ content: 'Would you like me to connect you now?' });
  });
});

describe('the stop check, before OpenAI', () => {
  it('stop words end the call as an opt-out, with the stop line - whatever she would have said', async () => {
    model.replies.push([text('Sure, happy to help!')]);
    conversation.heard('Stop calling me');
    await settle();
    expect(model.asked).toEqual([]);
    expect(sent).toEqual([
      { type: 'text', token: STOP, last: true },
      { type: 'end', handoffData: '{"action":"opt_out"}' },
    ]);
    expect(kept).toEqual([
      { who: 'system', text: 'Stop words heard: opted out.' },
      { who: 'seri', text: STOP, latencyMs: 0 },
      { who: 'action', text: '{"action":"opt_out"}' },
    ]);
    expect(ended).toEqual([{ action: 'opt_out' }]);
  });

  it('key 9 too; any other key means nothing to her', async () => {
    conversation.pressed('1');
    expect(sent).toEqual([]);
    conversation.pressed('9');
    expect(ends()).toEqual([{ type: 'end', handoffData: '{"action":"opt_out"}' }]);
    expect(kept[0]).toEqual({ who: 'system', text: 'Stop key 9 pressed: opted out.' });
  });

  it('a stop while she is still answering: her reply is cut, and the stop line follows', async () => {
    const g = gate();
    model.replies.push({ events: [text('Sure. '), text('Our offer is great.')], waitBefore: (i) => (i === 1 ? g.wait() : Promise.resolve()) });
    conversation.heard('Hello?');
    await until(() => tokens().length === 1, 'the first sentence');
    conversation.heard('Remove me from your list');
    g.open();
    await settle();
    expect(tokens()).toEqual([
      ['Sure. ', false],
      ['', true],
      [STOP, true],
    ]);
    expect(ended).toEqual([{ action: 'opt_out' }]);
  });

  it('"stop" inside a question is hers to answer', async () => {
    conversation.heard('Do I need to stop my other medicine?');
    await until(() => model.asked.length === 1, 'the request');
    expect(ended).toEqual([]);
  });
});

describe('limits and failures (A12)', () => {
  /** The call has started and Twilio has said the greeting. */
  const greeted = () => {
    conversation.start();
    conversation.speaking('agent', true);
    conversation.speaking('agent', false);
  };
  const stillThere = () => tokens().filter(([t]) => t === STILL_THERE_LINE).length;
  /** Three minutes in, the lead having talked all the while, so no silence was counted. */
  const threeMinutesIn = (extraMs = 0) => {
    conversation.start();
    conversation.speaking('client', true);
    clock.advance(LIMITS.callMs + extraMs);
    conversation.speaking('client', false);
  };
  const GOODBYE = 'Thanks so much for your time today. Have a great day!';

  describe('silence', () => {
    it('6 seconds after she stops talking: "are you still there?"; silent again, a goodbye and the end', () => {
      greeted();
      clock.advance(5_999);
      expect(sent).toEqual([]);
      clock.advance(1);
      expect(sent).toEqual([{ type: 'text', token: STILL_THERE_LINE, last: true }]);
      expect(kept).toEqual([{ who: 'seri', text: STILL_THERE_LINE, latencyMs: null }]);
      expect(conversation.messages.at(-1)).toEqual({ role: 'assistant', content: STILL_THERE_LINE });

      // Nothing counts while Twilio says it.
      conversation.speaking('agent', true);
      clock.advance(20_000);
      expect(ends()).toEqual([]);
      conversation.speaking('agent', false);
      clock.advance(6_000);

      expect(sent.slice(1)).toEqual([
        { type: 'text', token: 'Sorry I missed you, have a great day.', last: true },
        { type: 'end', handoffData: '{"action":"end_call","reason":"no_response"}' },
      ]);
      expect(ended).toEqual([{ action: 'end_call', reason: 'no_response' }]);
      expect(kept.at(-1)).toEqual({ who: 'action', text: '{"action":"end_call","reason":"no_response"}' });
      expect(model.asked).toEqual([]);
      expect(conversation.isOver).toBe(true);
      expect(clock.waiting).toBe(0);
      expect(logged.filter((l) => l.event === 'ai_relay.ended').map((l) => l.fields)).toEqual([
        { callId: 7, action: 'end_call', reason: 'no_response' },
      ]);
    });

    it('counted from when she stops talking, and not while the lead talks', () => {
      conversation.start();
      conversation.speaking('agent', true);
      clock.advance(20_000);
      conversation.speaking('agent', false);
      clock.advance(5_000);
      conversation.speaking('client', true);
      clock.advance(20_000);
      expect(sent).toEqual([]);
      // A noise, and no words: counted from when it stopped.
      conversation.speaking('client', false);
      clock.advance(5_999);
      expect(sent).toEqual([]);
      clock.advance(1);
      expect(stillThere()).toBe(1);
    });

    it('the lead answering puts it right: two silences in a row are needed again', async () => {
      greeted();
      clock.advance(6_000);
      conversation.heard('Yes, sorry');
      await until(() => kept.length === 2, 'her reply');
      expect(model.asked[0].slice(-2)).toEqual([
        { role: 'assistant', content: STILL_THERE_LINE },
        { role: 'user', content: '[Who is there: someone free] Yes, sorry' },
      ]);
      conversation.speaking('agent', true);
      conversation.speaking('agent', false);
      clock.advance(6_000);
      expect(stillThere()).toBe(2);
      expect(ended).toEqual([]);
    });

    it('a key says they are there too', () => {
      greeted();
      clock.advance(6_000);
      conversation.pressed('1');
      clock.advance(6_000);
      expect(stillThere()).toBe(2);
      expect(ended).toEqual([]);
    });

    it('not counted while she is answering', async () => {
      const g = gate();
      model.replies.push({ events: [text('Sure. '), text('Anything else?')], waitBefore: (i) => (i === 1 ? g.wait() : Promise.resolve()) });
      greeted();
      conversation.heard('Hello?');
      await until(() => tokens().length === 1, 'her first sentence');
      clock.advance(30_000);
      expect(tokens()).toEqual([['Sure. ', false]]);
      g.open();
      await until(() => kept.length === 1, 'her turn');
      clock.advance(6_000);
      expect(stillThere()).toBe(1);
    });

    it('not before the call has started', () => {
      clock.advance(10 * 60_000);
      expect(sent).toEqual([]);
      expect(clock.waiting).toBe(0);
    });
  });

  describe('three minutes', () => {
    it('a note to wrap up goes with her next reply, once', async () => {
      threeMinutesIn();
      expect(model.asked).toEqual([]);
      conversation.heard('Tell me more');
      await until(() => kept.length === 1, 'her reply');
      expect(model.asked[0].slice(-2)).toEqual([
        { role: 'user', content: '[Who is there: someone free] Tell me more' },
        { role: 'system', content: WRAP_UP_NOTE },
      ]);
      conversation.heard('Okay');
      await until(() => model.asked.length === 2, 'the second request');
      expect(model.asked[1].filter((m) => m.content === WRAP_UP_NOTE)).toHaveLength(1);
      expect(logged.filter((l) => l.event === 'ai_relay.wrap_up')).toHaveLength(1);
    });

    it('her action inside the 20 seconds ends the call as she chose', async () => {
      threeMinutesIn();
      model.replies.push([text("I'll text you the link now. Have a great day!"), tool('send_link')]);
      conversation.heard('I need to go');
      await until(() => ends().length === 1, 'the end');
      expect(ended).toEqual([{ action: 'send_link' }]);
      clock.advance(LIMITS.wrapUpMs);
      expect(ends()).toHaveLength(1);
      expect(clock.waiting).toBe(0);
    });

    it('20 seconds on without an ending: a goodbye, and the end', () => {
      conversation.start();
      conversation.speaking('client', true);
      clock.advance(LIMITS.callMs + LIMITS.wrapUpMs - 1);
      expect(sent).toEqual([]);
      clock.advance(1);
      expect(sent).toEqual([
        { type: 'text', token: GOODBYE, last: true },
        { type: 'end', handoffData: '{"action":"end_call","reason":"time_limit"}' },
      ]);
      expect(ended).toEqual([{ action: 'end_call', reason: 'time_limit' }]);
    });

    it('the 20 seconds run out while she is saying a reply: it is said whole, then the goodbye', async () => {
      const g = gate();
      threeMinutesIn();
      model.replies.push({ events: [text('Sure. '), text('Would you like the link?')], waitBefore: (i) => (i === 1 ? g.wait() : Promise.resolve()) });
      conversation.heard('Hmm');
      await until(() => tokens().length === 1, 'her first sentence');
      clock.advance(LIMITS.wrapUpMs);
      expect(ends()).toEqual([]);
      g.open();
      await until(() => ends().length === 1, 'the end');
      expect(tokens()).toEqual([
        ['Sure. ', false],
        ['Would you like the link? ', false],
        ['', true],
        [GOODBYE, true],
      ]);
      expect(ended).toEqual([{ action: 'end_call', reason: 'time_limit' }]);
    });

    it('... but a reply OpenAI never finishes is given 10 seconds, then the goodbye', async () => {
      const g = gate();
      threeMinutesIn();
      model.replies.push({ events: [text('Sure. '), text('Would you like the link?')], waitBefore: (i) => (i === 1 ? g.wait() : Promise.resolve()) });
      conversation.heard('Hmm');
      await until(() => tokens().length === 1, 'her first sentence');
      clock.advance(LIMITS.wrapUpMs + LIMITS.lastReplyMs - 1);
      expect(ends()).toEqual([]);
      clock.advance(1);
      expect(tokens()).toEqual([
        ['Sure. ', false],
        ['', true],
        [GOODBYE, true],
      ]);
      expect(ended).toEqual([{ action: 'end_call', reason: 'time_limit' }]);
      expect(clock.waiting).toBe(0);
    });

    it('... or the lead says more by then: the goodbye, not another reply', async () => {
      const g = gate();
      threeMinutesIn();
      model.replies.push({ events: [text('Sure. '), text('Would you like the link?')], waitBefore: (i) => (i === 1 ? g.wait() : Promise.resolve()) });
      conversation.heard('Hmm');
      await until(() => tokens().length === 1, 'her first sentence');
      clock.advance(LIMITS.wrapUpMs);
      conversation.heard('Wait, one more question');
      await settle();
      expect(model.asked).toHaveLength(1);
      expect(tokens()).toEqual([
        ['Sure. ', false],
        ['', true],
        [GOODBYE, true],
      ]);
      expect(ended).toEqual([{ action: 'end_call', reason: 'time_limit' }]);
    });

    it('... while OpenAI has not answered yet: ended at once', async () => {
      const g = gate();
      threeMinutesIn(LIMITS.wrapUpMs - 2_000);
      model.replies.push({ events: [text('Sure.')], waitBefore: () => g.wait() });
      conversation.heard('Hmm');
      await until(() => model.asked.length === 1, 'the request');
      clock.advance(2_000);
      expect(sent).toEqual([
        { type: 'text', token: GOODBYE, last: true },
        { type: 'end', handoffData: '{"action":"end_call","reason":"time_limit"}' },
      ]);
      g.open();
      await settle();
      expect(sent).toHaveLength(2);
    });
  });

  describe('OpenAI slow', () => {
    it('no first word in 4 seconds: "One moment...", and her reply follows it', async () => {
      const g = gate();
      model.replies.push({ events: [text('Sure, '), text('happy to help.')], waitBefore: (i) => (i === 0 ? g.wait() : Promise.resolve()) });
      conversation.heard('Hello?');
      await until(() => model.asked.length === 1, 'the request');
      clock.advance(LIMITS.firstWordMs - 1);
      expect(sent).toEqual([]);
      clock.advance(1);
      expect(tokens()).toEqual([[`${FILLER_LINE} `, false]]);
      expect(kept).toEqual([{ who: 'seri', text: FILLER_LINE, latencyMs: expect.any(Number) }]);

      g.open();
      await until(() => kept.length === 2, 'her reply');
      expect(tokens()).toEqual([
        [`${FILLER_LINE} `, false],
        ['Sure, happy to help. ', false],
        ['', true],
      ]);
      expect(kept[1]).toEqual({ who: 'seri', text: 'Sure, happy to help.', latencyMs: expect.any(Number) });
      // Not in what OpenAI reads: she would start saying it herself.
      expect(conversation.messages.at(-1)).toEqual({ role: 'assistant', content: 'Sure, happy to help.' });
      expect(replyEvents()[0]).toMatchObject({ filler: true, sentences: 1 });
      expect(logged.filter((l) => l.event === 'ai_relay.filler')).toEqual([{ event: 'ai_relay.filler', fields: { callId: 7, waitedMs: expect.any(Number) } }]);
      clock.advance(60_000);
      expect(ends()).toEqual([]);
    });

    it('still nothing 4 seconds later: the fallback - the script takes the call', async () => {
      const g = gate();
      model.replies.push({ events: [text('Sure.')], waitBefore: () => g.wait() });
      conversation.heard('Hello?');
      await until(() => model.asked.length === 1, 'the request');
      clock.advance(LIMITS.firstWordMs + LIMITS.afterFillerMs - 1);
      expect(ends()).toEqual([]);
      clock.advance(1);
      expect(sent).toEqual([
        { type: 'text', token: `${FILLER_LINE} `, last: false },
        { type: 'text', token: '', last: true },
        { type: 'end', handoffData: '{"action":"fallback","why":"model_slow"}' },
      ]);
      expect(ended).toEqual([{ action: 'fallback', why: 'model_slow' }]);
      expect(conversation.isOver).toBe(true);
      expect(logged.some((l) => l.event === 'ai_relay.model_slow')).toBe(true);
      g.open();
      await settle();
      expect(sent).toHaveLength(3);
    });

    it('the first word at 3.9 seconds: no filler', async () => {
      const g = gate();
      model.replies.push({ events: [text('Sure.')], waitBefore: (i) => (i === 0 ? g.wait() : Promise.resolve()) });
      conversation.heard('Hello?');
      await until(() => model.asked.length === 1, 'the request');
      clock.advance(3_900);
      g.open();
      await until(() => kept.length === 1, 'her reply');
      clock.advance(60_000);
      expect(tokens()).toEqual([
        ['Sure. ', false],
        ['', true],
      ]);
    });

    it('a refused action\'s second try is timed on its own', async () => {
      who = 'nobody';
      const g = gate();
      model.replies.push([tool('transfer_to_agent')], { events: [text('Everyone is busy.')], waitBefore: () => g.wait() });
      conversation.heard('Put me through');
      await until(() => model.asked.length === 2, 'the second request');
      clock.advance(LIMITS.firstWordMs);
      expect(tokens()).toEqual([[`${FILLER_LINE} `, false]]);
      g.open();
      await until(() => tokens().length === 3, 'her reply');
      expect(ends()).toEqual([]);
    });
  });

  describe('failing', () => {
    it('OpenAI failing: the session ends with the fallback', async () => {
      model.fail = new Error('openai down');
      conversation.heard('Hello?');
      await until(() => conversation.isOver, 'the end');
      expect(sent).toEqual([{ type: 'end', handoffData: '{"action":"fallback","why":"model_failed"}' }]);
      expect(ended).toEqual([{ action: 'fallback', why: 'model_failed' }]);
      expect(kept).toEqual([{ who: 'action', text: '{"action":"fallback","why":"model_failed"}' }]);
      expect(logged.filter((l) => l.event === 'ai_relay.model_failed')).toHaveLength(1);
    });

    it('failing mid-reply: what she said is closed first, then the fallback', async () => {
      model.replies.push({ events: [text('Sure. '), text('And more.')], waitBefore: (i) => (i === 1 ? Promise.reject(new Error('stream broke')) : Promise.resolve()) });
      conversation.heard('Hello?');
      await until(() => conversation.isOver, 'the end');
      expect(sent).toEqual([
        { type: 'text', token: 'Sure. ', last: false },
        { type: 'text', token: '', last: true },
        { type: 'end', handoffData: '{"action":"fallback","why":"model_failed"}' },
      ]);
      expect(kept.map((t) => t.who)).toEqual(['seri', 'action']);
    });

    it('the socket or the relay failing: the fallback, once, and every clock stopped', () => {
      greeted();
      conversation.fail('socket_error');
      conversation.fail('relay_failed');
      expect(sent).toEqual([{ type: 'end', handoffData: '{"action":"fallback","why":"socket_error"}' }]);
      expect(ended).toEqual([{ action: 'fallback', why: 'socket_error' }]);
      expect(clock.waiting).toBe(0);
    });

    it('closing stops every clock', async () => {
      const g = gate();
      model.replies.push({ events: [text('Sure.')], waitBefore: () => g.wait() });
      greeted();
      conversation.heard('Hello?');
      await until(() => model.asked.length === 1, 'the request');
      conversation.close();
      expect(clock.waiting).toBe(0);
      clock.advance(10 * 60_000);
      expect(sent).toEqual([]);
    });
  });

  it('every line the relay says itself passes the sentence check', () => {
    for (const line of [STILL_THERE_LINE, FILLER_LINE]) expect(checkSentence(line).reason).toBeNull();
  });
});

describe('waiting for Twilio\'s verdict before ending (A18)', () => {
  let verdict: VerdictState;
  let asked: number;
  let seri: Conversation;

  beforeEach(() => {
    verdict = 'pending';
    asked = 0;
    seri = new Conversation(
      {
        callId: 7,
        instructions: 'THE INSTRUCTIONS',
        greeting: 'Hi, is this John?',
        hours: DEFAULT_CALL_HOURS,
        stopLine: STOP,
        optOutWords: ANTIBIOTICS_CALL.optOutWords,
      },
      {
        model,
        whoIsThere: async () => who,
        keep: (turn) => kept.push(turn),
        ended: (handoff) => ended.push(handoff),
        send: (message) => sent.push(JSON.parse(message)),
        verdict: async () => {
          asked++;
          return verdict;
        },
        now: () => NOW,
        timers: clock,
      }
    );
  });

  /** "John isn't available" - a greeting she takes for the wrong person. */
  const sheEndsOnTheGreeting = async () => {
    model.replies.push([text('Sorry about that, have a great day.'), tool('end_call', { reason: 'wrong_person' })]);
    seri.heard("John isn't available right now.");
    await until(() => tokens().some(([t]) => t === 'Sorry about that, have a great day. '), 'her last line');
    await settle();
  };
  const waitLogs = () => logged.filter((l) => l.event === 'ai_relay.verdict_wait').map((l) => l.fields);
  /** Time passing as it does on a call: a poll every half second, each answered before the next. */
  const pass = async (ms: number) => {
    for (let waited = 0; waited < ms; waited += VERDICT_POLL_MS) {
      clock.advance(VERDICT_POLL_MS);
      await settle();
    }
  };

  it('no verdict yet: her last line said and her choice kept, but the call not ended', async () => {
    await sheEndsOnTheGreeting();
    expect(kept.filter((t) => t.who === 'action')).toEqual([{ who: 'action', text: JSON.stringify({ action: 'end_call', reason: 'wrong_person' }) }]);
    expect(ends()).toEqual([]);
    expect(ended).toEqual([]);
    expect(seri.isOver).toBe(true);
  });

  it('a person: the verdict comes, and the call ends as she chose', async () => {
    await sheEndsOnTheGreeting();
    await pass(1_000);
    verdict = 'in';
    await pass(VERDICT_POLL_MS);
    expect(ends()).toEqual([{ type: 'end', handoffData: JSON.stringify({ action: 'end_call', reason: 'wrong_person' }) }]);
    expect(ended).toEqual([{ action: 'end_call', reason: 'wrong_person' }]);
    expect(waitLogs()).toEqual([{ callId: 7, action: 'end_call', waitedMs: 1_500, verdict: 'in' }]);
  });

  it('a greeting, then its beep: the voicemail message took the call - nothing ended, nothing recorded, a note why', async () => {
    await sheEndsOnTheGreeting();
    await pass(4_000);
    verdict = 'taken';
    await pass(VERDICT_POLL_MS);
    await pass(VERDICT_WAIT_MS);
    expect(ends()).toEqual([]);
    expect(ended).toEqual([]);
    expect(kept.at(-1)).toEqual({ who: 'system', text: VOICEMAIL_TOOK_NOTE });
    expect(waitLogs()).toEqual([{ callId: 7, action: 'end_call', waitedMs: 4_500, verdict: 'taken' }]);
  });

  it('no verdict in 15 seconds: the call ends all the same', async () => {
    await sheEndsOnTheGreeting();
    await pass(VERDICT_WAIT_MS);
    expect(ends()).toHaveLength(1);
    expect(ended).toEqual([{ action: 'end_call', reason: 'wrong_person' }]);
    expect(waitLogs()).toEqual([{ callId: 7, action: 'end_call', waitedMs: VERDICT_WAIT_MS, verdict: 'none' }]);
    expect(clock.waiting).toBe(0);
  });

  it('the socket closes while it waits - the lead hung up, or the message took the call: nothing more', async () => {
    await sheEndsOnTheGreeting();
    seri.close();
    expect(clock.waiting).toBe(0);
    verdict = 'in';
    clock.advance(VERDICT_WAIT_MS);
    await settle();
    expect(ends()).toEqual([]);
    expect(ended).toEqual([]);
  });

  it('the link and a call back wait too', async () => {
    model.replies.push([text("I'll text you the link now."), tool('send_link')]);
    seri.heard('Just text me.');
    await until(() => tokens().length > 0, 'her line');
    await settle();
    expect(ends()).toEqual([]);
    expect(asked).toBeGreaterThan(0);
  });

  it('a transfer and a stop do not wait - the verdict is not even asked', async () => {
    model.replies.push([text('Great, connecting you now.'), tool('transfer_to_agent')]);
    seri.heard('Yes, put me through.');
    await until(() => ends().length === 1, 'the transfer');
    expect(asked).toBe(0);

    sent = [];
    const stopper = new Conversation(
      { callId: 8, instructions: 'I', greeting: 'Hi there!', hours: DEFAULT_CALL_HOURS, stopLine: STOP, optOutWords: ANTIBIOTICS_CALL.optOutWords },
      {
        model,
        whoIsThere: async () => who,
        keep: () => undefined,
        ended: () => undefined,
        send: (message) => sent.push(JSON.parse(message)),
        verdict: async () => {
          asked++;
          return 'pending';
        },
        timers: clock,
      }
    );
    stopper.heard('Stop calling me.');
    expect(ends()).toHaveLength(1);
    expect(asked).toBe(0);
  });

  it('the verdict cannot be read: the call is not held', async () => {
    const failing = new Conversation(
      { callId: 9, instructions: 'I', greeting: 'Hi there!', hours: DEFAULT_CALL_HOURS, stopLine: STOP, optOutWords: ANTIBIOTICS_CALL.optOutWords },
      {
        model,
        whoIsThere: async () => who,
        keep: () => undefined,
        ended: (handoff) => ended.push(handoff),
        send: (message) => sent.push(JSON.parse(message)),
        verdict: async () => {
          throw new Error('database down');
        },
        timers: clock,
      }
    );
    model.replies.push([text('Thanks for your time.'), tool('end_call', { reason: 'not_interested' })]);
    failing.heard('Not interested.');
    await until(() => ends().length === 1, 'the end');
    expect(ended).toEqual([{ action: 'end_call', reason: 'not_interested' }]);
  });
});
