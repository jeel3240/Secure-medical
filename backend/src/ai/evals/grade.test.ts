/**
 * The answer test set's cases, and how a reply is marked - A09. No OpenAI
 * here: `npm run ai:eval` asks it; this proves the cases are well formed and
 * the marking is right.
 */
import { ACTIONS } from '../actions';
import { CALL_HEADING } from '../instructions';
import { loadKnowledge } from '../knowledge';
import { caseMessages, grade, loadCases, OUTCOMES, says, type EvalCase } from './grade';

const knowledge = loadKnowledge();
const cases = loadCases();
const byId = (id: string) => cases.find((c) => c.id === id) as EvalCase;
const reply = (text: string, ...calls: [string, object?][]) => ({
  text,
  toolCalls: calls.map(([name, args]) => ({ name, arguments: JSON.stringify(args ?? {}) })),
});

describe('the cases', () => {
  it('74, each named once', () => {
    expect(cases).toHaveLength(74);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('each expects outcomes that exist, ends on the lead, and checks against the defaults too', () => {
    for (const c of cases) {
      expect(c.expect.length).toBeGreaterThan(0);
      for (const outcome of c.expect) expect(OUTCOMES).toContain(outcome);
      expect('lead' in c.turns[c.turns.length - 1]).toBe(true);
      expect(c.mustNotSay).toEqual(expect.arrayContaining(['$', 'dollars', 'i don\'t know']));
    }
  });

  it('every action, and talking on, is expected somewhere; each of who is there is tried', () => {
    const expected = new Set(cases.flatMap((c) => c.expect));
    for (const outcome of ['none', ...ACTIONS]) expect(expected).toContain(outcome);
    expect(new Set(cases.map((c) => c.who))).toEqual(new Set(['free', 'coming', 'nobody']));
  });

  it('every objection in the playbook has a case', () => {
    for (const id of ['no_once', 'too_expensive', 'scam', 'busy', 'think_about_it', 'have_doctor', 'no_antibiotics', 'never_signed_up', 'wrong_number']) {
      expect(byId(id)).toBeDefined();
    }
    expect(knowledge.playbook.objections).toHaveLength(9);
  });
});

describe('a case, as OpenAI gets it', () => {
  it('the instructions, the greeting, the opening, then each turn with who is there before the lead\'s', () => {
    const messages = caseMessages(byId('no_twice'), knowledge);
    expect(messages.map((m) => m.role)).toEqual(['system', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
    expect(messages[0].content).toContain(CALL_HEADING);
    expect(messages[1].content).toBe('[friendly] Hi, is this John?');
    expect(messages[2].content).toBe('[Who is there: someone free] Yes, this is John.');
    expect(messages[6].content).toBe('[Who is there: someone free] No, really, I\'m not interested. No link.');
  });

  it('a case at the greeting starts there; one with nobody there says so', () => {
    expect(caseMessages(byId('wrong_person_at_greeting'), knowledge).map((m) => m.role)).toEqual(['system', 'assistant', 'user']);
    expect(caseMessages(byId('yes_order_now_nobody'), knowledge)[4].content).toBe('[Who is there: nobody] Yes, I\'d like to order now.');
  });
});

describe('marking a reply', () => {
  it('the expected action, with her last line: a pass', () => {
    expect(grade(byId('yes_order_now_free'), reply('Great, connecting you now.', ['transfer_to_agent']))).toEqual({
      outcome: 'transfer_to_agent',
      problems: [],
      heard: 'Great, connecting you now.',
      defaultLine: false,
      toned: false,
      wroteAction: false,
    });
  });

  it('the action with no words: the lead hears its own last line', () => {
    expect(grade(byId('callback_confirmed'), reply('', ['book_callback', { time: '2026-11-12T15:00', time_zone: 'America/New_York', reason: 'Wants to order' }]))).toEqual({
      outcome: 'book_callback',
      problems: [],
      heard: 'Perfect, someone from our team will call you tomorrow at 3 PM your time. Have a great day!',
      defaultLine: true,
      toned: false,
      wroteAction: false,
    });
  });

  it('her tones are not words: graded on what the lead hears, and noted', () => {
    expect(grade(byId('yes_order_now_free'), reply('[cheerfully] Great, connecting you now.', ['transfer_to_agent']))).toEqual({
      outcome: 'transfer_to_agent',
      problems: [],
      heard: 'Great, connecting you now.',
      defaultLine: false,
      toned: true,
      wroteAction: false,
    });
  });

  it('an action written in brackets is taken, as the relay takes it, and counted - not a fail', () => {
    expect(grade(byId('no_but_link'), reply("[friendly] Sure. I'll text you the link now. Have a great day! [send_link]"))).toMatchObject({
      outcome: 'send_link',
      problems: [],
      wroteAction: true,
    });
  });

  it('a bracket that is not one of her tones fails - the voice could say it aloud', () => {
    expect(grade(byId('yes_order_now_free'), reply('[laughs] Great, connecting you now.', ['transfer_to_agent'])).problems).toEqual([
      'not one of her tones: [laughs]',
    ]);
    expect(grade(byId('yes_order_now_free'), reply('[Who is there: someone free] Great, connecting you now.', ['transfer_to_agent'])).problems).toEqual([
      'not one of her tones: [Who is there: someone free]',
    ]);
  });

  it('booked for the wrong time, or refused', () => {
    const c = byId('callback_confirmed');
    // 4 PM, when she had said back 3 PM: never booked, as on a call (A21, call 92).
    expect(grade(c, reply('Bye!', ['book_callback', { time: '2026-11-12T16:00', time_zone: 'America/New_York', reason: 'x' }])).problems).toEqual([
      expect.stringMatching(/^refused: Not booked: they have not agreed this time with you\./),
    ]);
    expect(grade(c, reply('Bye!', ['book_callback', { time: '2026-11-12T21:00', time_zone: 'America/New_York', reason: 'x' }])).problems[0]).toMatch(
      /^refused: Not booked\. That is outside the agent hours\./
    );
  });

  it('an action after a question is held back: talking on, which passes where that is expected', () => {
    const asked = reply('Yes, we serve all 50 states. Would you like me to connect you now?', ['transfer_to_agent']);
    expect(grade(byId('states'), asked)).toMatchObject({ outcome: 'none', problems: [] });
    expect(grade(byId('yes_order_now_free'), reply('Shall I connect you?', ['transfer_to_agent'])).problems).toEqual([
      'none, expected transfer_to_agent',
    ]);
  });

  it('the wrong outcome, the wrong reason, two actions', () => {
    expect(grade(byId('stop'), reply('Okay, bye.')).problems).toEqual(['none, expected opt_out']);
    expect(grade(byId('wrong_number'), reply('Bye.', ['end_call', { reason: 'not_interested' }])).problems).toEqual([
      'ended for not_interested, expected wrong_person',
    ]);
    expect(grade(byId('stop'), reply('Okay, we will not call you again. Goodbye.', ['opt_out'], ['end_call', { reason: 'other' }])).problems).toEqual([
      'more than one action: opt_out, end_call',
    ]);
  });

  it('an opt-out in her own words ends with the stop line', () => {
    expect(grade(byId('stop'), reply("I'll take you off our list.", ['opt_out']))).toMatchObject({
      problems: [],
      heard: "I'll take you off our list. Okay, we will not call you again. Goodbye.",
      defaultLine: true,
    });
  });

  it('words she must say, must not say, and what the sentence check would replace', () => {
    expect(grade(byId('scam'), reply('We are legit.')).problems).toEqual(['said none of: 25 years / twenty-five years / trustpilot']);
    expect(grade(byId('price'), reply('It is 39 or so, I think.')).problems).toEqual(['said "39"']);
    expect(grade(byId('price'), reply('It costs $39. Want it?')).problems).toEqual([
      'said "$"',
      'said "39"',
      'would be replaced (price, "$"): It costs $39.',
    ]);
    expect(grade(byId('hmm'), reply('')).problems).toEqual(['said nothing']);
  });

  it('whole words, any case', () => {
    expect(says('I’m an AI assistant.', 'ai')).toBe(true);
    expect(says('I said it again.', 'ai')).toBe(false);
    expect(says('Call 911 now.', '911')).toBe(true);
    expect(says('That is $39.', '$')).toBe(true);
    expect(says('I DON’T KNOW', "i don't know")).toBe(true);
  });
});
