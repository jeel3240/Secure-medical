/**
 * Seri's five actions - A06, AI-AGENT.md section 3.
 *
 * 2026-11-11 is a Wednesday; noon in Arizona is 2 PM in New York (EST, two
 * hours ahead of Arizona in winter).
 */
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { ANTIBIOTICS_CALL } from '../core/call-script-fixtures';
import {
  ACTION_TOOLS,
  ACTIONS,
  END_REASONS,
  RELAY_END_REASONS,
  fallbackHandoff,
  fromHandoff,
  handoffData,
  lastLine,
  lineToAdd,
  NOT_AGREED,
  toHandoff,
  writtenAction,
  type ActionContext,
  type Handoff,
} from './actions';
import { checkSentence } from './safety';

const NOW = new Date('2026-11-11T19:00:00Z');
const NY = 'America/New_York';
const context = (over: Partial<ActionContext> = {}): ActionContext => ({
  whoIsThere: 'free',
  hours: DEFAULT_CALL_HOURS,
  now: NOW,
  said: 'Great, connecting you now.',
  before: "So that's tomorrow at 3 PM your time?",
  ...over,
});
const call = (name: string, args: unknown = {}, over: Partial<ActionContext> = {}) =>
  toHandoff({ name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }, context(over));
/** "2026-11-12T13:00" said back as she confirms it: "So that's 1 PM your time?" */
const saidBack = (time: string) => {
  const [hour24, minute] = time.slice(11).split(':').map(Number);
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `So that's ${hour}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${hour24 < 12 ? 'AM' : 'PM'} your time?`;
};
/** A call back for `time`, which she has said back to the lead - unless the test says otherwise. */
const book = (time: string, over: Partial<ActionContext> = {}, zone = NY) =>
  call('book_callback', { time, time_zone: zone, reason: 'Wants to order antibiotics' }, { before: saidBack(time), ...over });
const error = (result: ReturnType<typeof call>) => (result.ok ? 'booked' : result.error);

describe('the tools OpenAI is offered', () => {
  it('the five actions, strict, every argument required and nothing else allowed', () => {
    expect(ACTION_TOOLS.map((t) => t.function.name)).toEqual([...ACTIONS]);
    for (const t of ACTION_TOOLS) {
      const parameters = t.function.parameters as { properties: object; required: string[]; additionalProperties: boolean };
      expect(t.type).toBe('function');
      expect(t.function.strict).toBe(true);
      expect(t.function.description).toBeTruthy();
      expect(parameters.additionalProperties).toBe(false);
      expect([...parameters.required].sort()).toEqual(Object.keys(parameters.properties).sort());
    }
  });

  it('a call back takes the time on the lead\'s clock, their zone and a reason; an ending, its reason', () => {
    const [, booking, , , ending] = ACTION_TOOLS.map((t) => t.function.parameters as { required: string[]; properties: Record<string, { enum?: string[] }> });
    expect(booking.required).toEqual(['time', 'time_zone', 'reason']);
    expect(ending.properties.reason.enum).toEqual([...END_REASONS]);
  });
});

describe('a tool call, carried across Twilio and back', () => {
  it.each<[string, unknown, Handoff]>([
    ['transfer_to_agent', {}, { action: 'transfer_to_agent' }],
    [
      'book_callback',
      { time: '2026-11-12T15:00', time_zone: NY, reason: '  Wants to order   antibiotics ' },
      { action: 'book_callback', at: '2026-11-12T20:00:00.000Z', timeZone: NY, reason: 'Wants to order antibiotics' },
    ],
    ['send_link', {}, { action: 'send_link' }],
    ['opt_out', {}, { action: 'opt_out' }],
    ['end_call', { reason: 'not_interested' }, { action: 'end_call', reason: 'not_interested' }],
    ['end_call', { reason: 'wrong_person' }, { action: 'end_call', reason: 'wrong_person' }],
    ['end_call', { reason: 'emergency' }, { action: 'end_call', reason: 'emergency' }],
    ['end_call', { reason: 'other' }, { action: 'end_call', reason: 'other' }],
  ])('%s %j', (name, args, handoff) => {
    const result = call(name, args);
    expect(result).toEqual({ ok: true, handoff });
    expect(fromHandoff(handoffData(handoff))).toEqual(handoff);
  });

  it('the relay\'s own fallback, too', () => {
    expect(fromHandoff(handoffData(fallbackHandoff('openai_timeout')))).toEqual({ action: 'fallback', why: 'openai_timeout' });
  });

  it('the relay\'s own endings read back (A12) - but she cannot choose them', () => {
    for (const reason of RELAY_END_REASONS) {
      const handoff: Handoff = { action: 'end_call', reason };
      expect(fromHandoff(handoffData(handoff))).toEqual(handoff);
      expect(call('end_call', { reason })).toEqual({ ok: false, error: expect.stringMatching(/^end_call needs a reason/) });
    }
  });

  it('no arguments at all reads as none', () => {
    expect(call('send_link', '')).toEqual({ ok: true, handoff: { action: 'send_link' } });
  });
});

describe('a call back at a time that cannot be booked: refused, with what to offer', () => {
  it('8 PM: tomorrow at the opening, on the lead\'s clock - and that one books', () => {
    expect(error(book('2026-11-11T20:00'))).toBe(
      'Not booked. That is outside the agent hours. Offer tomorrow at 1 PM your time instead, and if they agree, book it as 2026-11-12T13:00.'
    );
    expect(book('2026-11-12T13:00').ok).toBe(true);
  });

  it('a weekend: Monday at the same time', () => {
    expect(error(book('2026-11-14T15:00'))).toBe(
      'Not booked. That is outside the agent hours. Offer Monday at 3 PM your time instead, and if they agree, book it as 2026-11-16T15:00.'
    );
  });

  it('in Arizona\'s own time', () => {
    expect(error(book('2026-11-11T20:00', {}, 'America/Phoenix'))).toBe(
      'Not booked. That is outside the agent hours. Offer tomorrow at 11 AM your time instead, and if they agree, book it as 2026-11-12T11:00.'
    );
  });

  it('past, too soon, too far', () => {
    expect(error(book('2026-11-11T13:00'))).toMatch(/^Not booked\. That time has already passed\. Offer today at 2:15 PM your time instead/);
    expect(error(book('2026-11-11T14:05'))).toMatch(/^Not booked\. That is too soon: a call back must be at least 15 minutes away\. Offer today at 2:15 PM/);
    expect(error(book('2026-12-01T15:00'))).toMatch(/^Not booked\. That is too far ahead: call backs are booked up to 14 days ahead\. Offer Tuesday, November 24 at 3 PM your time instead, and if they agree, book it as 2026-11-24T15:00\.$/);
  });

  it('with no hours at all in the settings: the link instead', () => {
    expect(error(book('2026-11-12T15:00', { hours: { ...DEFAULT_CALL_HOURS, days: new Set() } }))).toBe(
      'Not booked. That is outside the agent hours. Offer to text them the link instead.'
    );
  });
});

describe('a call back only for the time she said back, and they agreed (A21, call 92)', () => {
  it('never said back - a "yes" to being put through, with nobody free: refused, and she asks when instead', () => {
    expect(error(book('2026-11-11T14:15', { before: 'Would you like me to connect you with someone now to place your order?', whoIsThere: 'nobody' }))).toBe(NOT_AGREED);
    expect(NOT_AGREED).toMatch(/Ask when suits them/);
  });

  it('another time said back: refused', () => {
    expect(error(book('2026-11-12T16:00', { before: "So that's tomorrow at 3 PM your time?" }))).toBe(NOT_AGREED);
    expect(error(book('2026-11-12T15:00', { before: "So that's tomorrow at 13 PM your time?" }))).toBe(NOT_AGREED);
  });

  it('said back as she says it, or any usual way: booked', () => {
    for (const before of ["So that's tomorrow at 3 PM your time?", 'Tomorrow at 3:00 p.m., right?', 'tomorrow at 3pm?', 'Thursday at 3 P.M. your time?']) {
      expect(book('2026-11-12T15:00', { before }).ok).toBe(true);
    }
  });

  it('half past: the minutes are said too', () => {
    expect(error(book('2026-11-12T15:30', { before: "So that's tomorrow at 3 PM your time?" }))).toBe(NOT_AGREED);
    expect(book('2026-11-12T15:30', { before: "So that's tomorrow at 3:30 PM your time?" }).ok).toBe(true);
  });

  it('noon, in words or as 12 PM', () => {
    // Noon in Arizona, inside the agents' hours.
    const AZ = 'America/Phoenix';
    expect(book('2026-11-12T12:00', { before: 'So tomorrow at noon your time?' }, AZ).ok).toBe(true);
    expect(book('2026-11-12T12:00', { before: 'So tomorrow at 12 PM your time?' }, AZ).ok).toBe(true);
    expect(error(book('2026-11-12T12:00', { before: 'So tomorrow at 12 AM your time?' }, AZ))).toBe(NOT_AGREED);
  });

  it('a time outside the hours is refused with what to offer first, said back or not', () => {
    expect(error(book('2026-11-11T20:00', { before: 'Would that work?' }))).toMatch(/^Not booked\. That is outside the agent hours\. Offer tomorrow at 1 PM/);
  });
});

describe('a call back\'s arguments, checked', () => {
  it.each([
    [{ time: '2026-11-12 15:00', time_zone: NY, reason: 'x' }, /^time must be/],
    [{ time: 'tomorrow at 3', time_zone: NY, reason: 'x' }, /^time must be/],
    [{ time: '2026-11-12T15:00Z', time_zone: NY, reason: 'x' }, /^time must be/],
    [{ time: '2026-11-12T15:00', time_zone: 'Eastern', reason: 'x' }, /^time_zone must be/],
    [{ time: '2026-11-12T15:00', reason: 'x' }, /^time_zone must be/],
    [{ time: '2026-11-12T15:00', time_zone: NY, reason: '   ' }, /^reason must be/],
    [{ time: '2026-11-12T15:00', time_zone: NY, reason: 'x'.repeat(201) }, /^reason must be/],
  ])('%j', (args, message) => {
    expect(error(call('book_callback', args))).toMatch(message);
  });
});

describe('who is there decides a transfer', () => {
  it('someone free, or someone coming: put through', () => {
    expect(call('transfer_to_agent', {}, { whoIsThere: 'free' }).ok).toBe(true);
    expect(call('transfer_to_agent', {}, { whoIsThere: 'coming' }).ok).toBe(true);
  });

  it('nobody: refused, with a call back to offer instead', () => {
    expect(error(call('transfer_to_agent', {}, { whoIsThere: 'nobody' }))).toBe(
      'Nobody can take a call right now, so do not transfer. Tell the lead everyone is busy, and ask when would be a good time for a call back, inside the agent hours. Book it with book_callback only once you have said their time back to them and they have said yes.'
    );
    expect(book('2026-11-12T15:00', { whoIsThere: 'nobody' }).ok).toBe(true);
  });
});

describe('a tool call that is not one', () => {
  it('an action that does not exist', () => {
    expect(error(call('take_payment'))).toBe(
      'There is no action called take_payment. Use one of: transfer_to_agent, book_callback, send_link, opt_out, end_call.'
    );
  });

  it('arguments that cannot be read', () => {
    expect(error(call('end_call', '{"reason":'))).toBe('The arguments for end_call could not be read. Try again.');
    expect(error(call('end_call', '["not_interested"]'))).toBe('The arguments for end_call could not be read. Try again.');
  });

  it('an ending with no reason, or one not on the list', () => {
    expect(error(call('end_call', {}))).toBe('end_call needs a reason: one of not_interested, wrong_person, emergency, other.');
    expect(error(call('end_call', { reason: 'bored' }))).toBe('end_call needs a reason: one of not_interested, wrong_person, emergency, other.');
  });
});

describe('what Twilio hands back, read safely', () => {
  it.each<[unknown, string]>([
    [undefined, 'no_handoff'],
    [null, 'no_handoff'],
    ['', 'no_handoff'],
    [42, 'no_handoff'],
    ['not json', 'unreadable_handoff'],
    ['[]', 'unreadable_handoff'],
    ['"transfer_to_agent"', 'unreadable_handoff'],
    ['{}', 'unknown_action'],
    ['{"action":"teleport"}', 'unknown_action'],
    ['{"action":"end_call"}', 'unreadable_handoff'],
    ['{"action":"end_call","reason":"bored"}', 'unreadable_handoff'],
    ['{"action":"book_callback","at":"tomorrow","timeZone":"America/New_York","reason":"x"}', 'unreadable_handoff'],
    ['{"action":"book_callback","at":"2026-11-12T20:00:00.000Z","timeZone":"Eastern","reason":"x"}', 'unreadable_handoff'],
    ['{"action":"book_callback","at":"2026-11-12T20:00:00.000Z","timeZone":"America/New_York","reason":""}', 'unreadable_handoff'],
    ['{"action":"fallback"}', 'unknown'],
  ])('%j is a fallback: %s', (raw, why) => {
    expect(fromHandoff(raw)).toEqual({ action: 'fallback', why });
  });

  it('extra fields are dropped, never passed on', () => {
    expect(fromHandoff('{"action":"opt_out","block":"+15551234567"}')).toEqual({ action: 'opt_out' });
    expect(fromHandoff('{"action":"end_call","reason":"other","say":"anything"}')).toEqual({ action: 'end_call', reason: 'other' });
  });
});

describe('an action right after a question waits for the answer (A09)', () => {
  it.each(ACTIONS.filter((a) => a !== 'opt_out'))('%s after "...connect you?" is held back, and nothing more is said', (name) => {
    const args = name === 'book_callback' ? { time: '2026-11-12T15:00', time_zone: NY, reason: 'x' } : name === 'end_call' ? { reason: 'other' } : {};
    expect(call(name, args, { said: 'You can get up to 25% off. Would you like me to connect you with someone now?' })).toEqual({
      ok: false,
      awaitLead: true,
      error: `Not done: your reply asked the lead a question. Wait for their answer, and take ${name} in a later reply if it still fits.`,
    });
  });

  it('a stop is never held back: taken at once, whatever she said with it (A21)', () => {
    expect(call('opt_out', {}, { said: 'Okay, we will not call you again. Goodbye. Hi, is this John?' })).toEqual({
      ok: true,
      handoff: { action: 'opt_out' },
    });
  });

  it('a question anywhere in the reply holds it back too - asked, then the link sent before the answer (A21, call 89)', () => {
    expect(
      call('send_link', {}, { said: 'Got it, Jeel. Is it more the timing, or just not something you need right now? I can also text you a link to browse later.' })
    ).toMatchObject({ ok: false, awaitLead: true });
    expect(call('transfer_to_agent', {}, { said: 'Any questions? Great, connecting you now.' })).toMatchObject({ ok: false, awaitLead: true });
  });

  it('no question at all: taken', () => {
    expect(call('send_link', {}, { said: "Sure, I'll text you the link now. Have a great day!" }).ok).toBe(true);
    expect(call('transfer_to_agent', {}, { said: '' }).ok).toBe(true);
  });

  it('an action that does not exist is still named as such', () => {
    expect(error(call('take_payment', {}, { said: 'Shall I?' }))).toMatch(/^There is no action called take_payment/);
  });
});

describe('the line the relay adds after hers (A09)', () => {
  const ctx = { stopLine: ANTIBIOTICS_CALL.optOutBody, now: NOW };
  const booked: Handoff = { action: 'book_callback', at: '2026-11-12T20:00:00.000Z', timeZone: NY, reason: 'Wants to order' };

  it('no words before the action: its own last line', () => {
    expect(lineToAdd({ action: 'transfer_to_agent' }, '', ctx)).toBe('Great, connecting you now.');
    expect(lineToAdd(booked, '  ', ctx)).toBe('Perfect, someone from our team will call you tomorrow at 3 PM your time. Have a great day!');
    expect(lineToAdd({ action: 'send_link' }, '', ctx)).toBe("I'll text you the link now. Have a great day!");
    expect(lineToAdd({ action: 'opt_out' }, '', ctx)).toBe('Okay, we will not call you again. Goodbye.');
    expect(lineToAdd({ action: 'end_call', reason: 'not_interested' }, '', ctx)).toBe('Thanks for your time. Have a great day!');
    expect(lineToAdd({ action: 'end_call', reason: 'wrong_person' }, '', ctx)).toBe('Sorry about that, have a great day.');
    expect(lineToAdd({ action: 'end_call', reason: 'emergency' }, '', ctx)).toBe('If this is a medical emergency, please hang up and call 911.');
    expect(lineToAdd({ action: 'end_call', reason: 'no_response' }, '', ctx)).toBe('Sorry I missed you, have a great day.');
    expect(lineToAdd({ action: 'end_call', reason: 'time_limit' }, '', ctx)).toBe('Thanks so much for your time today. Have a great day!');
    expect(lineToAdd(fallbackHandoff('openai_timeout'), '', ctx)).toBeNull();
  });

  it('her own words: nothing added', () => {
    expect(lineToAdd({ action: 'transfer_to_agent' }, 'Sure thing, connecting you now.', ctx)).toBeNull();
    expect(lineToAdd(booked, 'Perfect, talk to you then. Bye!', ctx)).toBeNull();
  });

  it('an opt-out always ends with the stop line', () => {
    expect(lineToAdd({ action: 'opt_out' }, 'I understand. Okay, we will not call you again. Goodbye.', ctx)).toBeNull();
    expect(lineToAdd({ action: 'opt_out' }, 'Okay, we will NOT call you again - goodbye!', ctx)).toBeNull();
    expect(lineToAdd({ action: 'opt_out' }, "I'll remove your number right now.", ctx)).toBe('Okay, we will not call you again. Goodbye.');
  });

  it('every one passes the sentence check', () => {
    const handoffs: Handoff[] = [
      { action: 'transfer_to_agent' },
      booked,
      { action: 'send_link' },
      { action: 'opt_out' },
      ...[...END_REASONS, ...RELAY_END_REASONS].map((reason): Handoff => ({ action: 'end_call', reason })),
    ];
    for (const handoff of handoffs) {
      const line = lastLine(handoff, ctx)!;
      for (const sentence of line.split(/(?<=[.?!])\s+/)) expect(checkSentence(sentence).reason).toBeNull();
    }
  });
});

describe('an action she wrote in brackets instead of taking it (A21)', () => {
  it('each way it was seen written', () => {
    expect(writtenAction('Sure. [send_link]')).toEqual({ name: 'send_link', arguments: '{}' });
    expect(writtenAction('[opt_out] Okay, we will not call you again.')).toEqual({ name: 'opt_out', arguments: '{}' });
    expect(writtenAction('Goodbye. [functions.opt_out()]')).toEqual({ name: 'opt_out', arguments: '{}' });
    expect(
      writtenAction('Have a great day! [functions.book_callback:{"time":"2026-11-12T14:00","time_zone":"America/New_York","reason":"Wants to order"}]')
    ).toEqual({ name: 'book_callback', arguments: '{"time":"2026-11-12T14:00","time_zone":"America/New_York","reason":"Wants to order"}' });
  });

  it('nothing for a tone, our note, a word that is not an action, or no bracket', () => {
    expect(writtenAction('[friendly] Hi.')).toBeNull();
    expect(writtenAction('[Who is there: nobody] Sure.')).toBeNull();
    expect(writtenAction('[pay_now] Sure.')).toBeNull();
    expect(writtenAction('I can send_link you.')).toBeNull();
  });
});
