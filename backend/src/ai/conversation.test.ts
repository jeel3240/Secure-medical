/**
 * One call's conversation with Seri - A11. A fake OpenAI that answers as told,
 * and the messages the relay would send Twilio: sentences as they are whole,
 * the sentence check, being talked over, each action, and the stop check.
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { ANTIBIOTICS_CALL } from '../core/call-script-fixtures';
import * as logModule from '../lib/log';
import type { Handoff } from './actions';
import { Conversation, leadMessage } from './conversation';
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
let conversation: Conversation;

beforeEach(() => {
  model = new FakeModel();
  who = 'free';
  sent = [];
  kept = [];
  ended = [];
  logged = [];
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
    });
  });

  it('OpenAI failing is logged, and nothing is said (what the call does next is A12\'s)', async () => {
    model.fail = new Error('openai down');
    conversation.heard('Hello?');
    await until(() => logged.some((l) => l.event === 'ai_relay.model_failed'), 'the failure');
    expect(sent).toEqual([]);
    expect(conversation.isOver).toBe(false);
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
