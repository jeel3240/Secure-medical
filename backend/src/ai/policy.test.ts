/**
 * What Seri does next (A27) - every path of the playbook, and every
 * structural failure of A21's real calls 86-112, decided the same way every
 * time.
 */
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { loadKnowledge } from './knowledge';
import type { WhoIsThere } from './instructions';
import {
  asks,
  decide,
  markOpening,
  markSaid,
  REAL_PERSON,
  resolveTime,
  startState,
  UNCOVERED,
  wrapUpDue,
  type Act,
  type CallState,
  type Move,
  type PolicyContext,
} from './policy';

const knowledge = loadKnowledge();
/** Wednesday 2026-11-11, noon in Arizona - the answer test set's "now". */
const WEDNESDAY_NOON = new Date('2026-11-11T19:00:00Z');
/** Friday 2026-11-13, 4:39 PM in Arizona - call 93. */
const FRIDAY_AFTERNOON = new Date('2026-11-13T23:39:00Z');

const context = (who: WhoIsThere = 'free', now = WEDNESDAY_NOON, leadZone = 'America/Phoenix'): PolicyContext => ({
  who,
  now,
  hours: DEFAULT_CALL_HOURS,
  leadZone,
  knowledge,
});

const yes: Act = { act: 'agrees' };
const no: Act = { act: 'declines' };
const asking = (topic: string): Act => ({ act: 'asks', topic });

/** One turn: the lead's acts, her moves - all of them said. */
function turn(state: CallState, acts: Act[], ctx = context()): { state: CallState; moves: Move[] } {
  const decision = decide(state, acts, ctx);
  return { state: markSaid(decision.state, decision.moves), moves: decision.moves };
}

/** A call that has had its opening: the lead said "yes" to the greeting. */
function opened(ctx = context()): CallState {
  return turn(startState(), [{ act: 'confirm_identity' }], ctx).state;
}

const names = (moves: Move[]) =>
  moves.map((m) => {
    if (m.move === 'offer') return `offer:${m.kind}`;
    if (m.move === 'answer') return `answer:${m.id}${m.again ? ':again' : ''}`;
    if (m.move === 'end') return `end:${m.handoff.action}${'reason' in m.handoff ? `:${m.handoff.reason}` : ''}`;
    if (m.move === 'return_to') return `return_to:${m.open}`;
    if (m.move === 'objection') return `objection:${m.id}`;
    if (m.move === 'specialist') return `specialist${m.again ? ':again' : ''}`;
    return m.move;
  });

describe('the opening - once, at the start', () => {
  it.each<[string, Act[]]>([
    ['"Yes."', [{ act: 'confirm_identity' }]],
    ['"Yes" as a yes to the greeting', [yes]],
    ['"Hello?" - they did not hear it', [{ act: 'checking_line' }]],
    ['"Who is this?"', [asking('who_we_are')]],
    ['"What is this about?"', [asking('why_calling')]],
    ['"Okay."', [{ act: 'backchannel' }]],
  ])('%s → who she is, the offer, and whether they are interested', (_, acts) => {
    expect(names(turn(startState(), acts).moves)).toEqual(['opening']);
  });

  it('a question the opening does not answer is answered first, then the opening', () => {
    expect(names(turn(startState(), [asking('how_got_number')]).moves)).toEqual(['answer:how_got_number', 'opening']);
  });

  it('is never said again (call 112: "Hello. Hello." two and a half minutes in) - she is here, and asks her question again', () => {
    let state = opened();
    state = turn(state, [asking('shipping')]).state;
    const { moves } = turn(state, [{ act: 'checking_line' }]);
    expect(names(moves)).toEqual(['still_here', 'return_to:interest']);
    expect(moves.some((m) => m.move === 'opening')).toBe(false);
  });

  it('"Yes" to the greeting is not interest in the offer (call 91)', () => {
    const state = opened(context('nobody'));
    expect(state.interest).toBe('unknown');
    expect(state.open).toBe('interest');
  });

  it('asking for a person straight away is answered as asked', () => {
    expect(names(turn(startState(), [{ act: 'wants_person' }]).moves)).toEqual(['end:transfer_to_agent']);
  });
});

describe('the wrong person - only said plainly, and only before they said it is them', () => {
  it('"No" to "Is this John?" ends the call', () => {
    expect(names(turn(startState(), [no]).moves)).toEqual(['end:end_call:wrong_person']);
  });

  it('"Wrong number" before they said it is them ends the call', () => {
    expect(names(turn(startState(), [{ act: 'wrong_person' }]).moves)).toEqual(['end:end_call:wrong_person']);
  });

  it('after they said it is them, a line like that was misheard (call 109, "Is this is Kim.") - asked again, never ended', () => {
    const { moves } = turn(opened(), [{ act: 'wrong_person' }]);
    expect(names(moves)).toEqual(['ask_repeat']);
  });
});

describe('a yes', () => {
  it('with someone free: an offer to connect, then a yes to it puts them through', () => {
    const first = turn(opened(), [{ act: 'interested' }]);
    expect(names(first.moves)).toEqual(['offer:connect']);
    const { moves } = turn(first.state, [yes]);
    expect(names(moves)).toEqual(['end:transfer_to_agent']);
  });

  it('with someone coming: put through all the same - the hold line waits for them', () => {
    const ctx = context('coming');
    const { state } = turn(opened(ctx), [{ act: 'interested' }], ctx);
    expect(names(turn(state, [yes], ctx).moves)).toEqual(['end:transfer_to_agent']);
  });

  it('with nobody: busy, said plainly, and when would suit - never "connect you now" (calls 92, 93)', () => {
    const ctx = context('nobody');
    const { state, moves } = turn(opened(ctx), [{ act: 'interested' }], ctx);
    expect(names(moves)).toEqual(['busy', 'ask_time']);
    // Busy is said once.
    const again = turn(state, [{ act: 'wants_person' }], ctx);
    expect(names(again.moves)).toEqual(['ask_time']);
  });

  it('the person turned down, interest shown: a call back instead, not a goodbye', () => {
    const { state } = turn(opened(), [{ act: 'interested' }]);
    expect(names(turn(state, [no]).moves)).toEqual(['offer:callback']);
  });

  it('a yes to an offer to connect after nobody came free: busy, and when would suit', () => {
    const { state } = turn(opened(), [{ act: 'interested' }]);
    expect(names(turn(state, [yes], context('nobody')).moves)).toEqual(['busy', 'ask_time']);
  });
});

describe('a no', () => {
  it('the first: why, asked alone - nothing offered with it (call 99)', () => {
    expect(names(turn(opened(), [{ act: 'not_interested', reason: null }]).moves)).toEqual(['ask_why']);
  });

  it('another no to the why is the second: the call ends, nothing more offered (call 99)', () => {
    const { state } = turn(opened(), [{ act: 'not_interested', reason: null }]);
    expect(names(turn(state, [{ act: 'not_interested', reason: 'closed' }]).moves)).toEqual(['end:end_call:not_interested']);
  });

  it('the timing, after the why: one offer, a call back; a no to it ends the call', () => {
    const why = turn(opened(), [no]).state;
    const { state, moves } = turn(why, [{ act: 'not_interested', reason: 'timing' }]);
    expect(names(moves)).toEqual(['offer:callback']);
    expect(names(turn(state, [no]).moves)).toEqual(['end:end_call:not_interested']);
  });

  it('"Not right now." - the timing: a call back offered, and nothing about who is busy (call 103)', () => {
    const ctx = context('nobody');
    const { moves } = turn(opened(ctx), [{ act: 'not_now' }], ctx);
    expect(names(moves)).toEqual(['offer:callback']);
    expect(moves.some((m) => m.move === 'busy')).toBe(false);
  });

  it('"I don\'t need antibiotics": the other products, once; a no to them ends the call (call 101)', () => {
    const offered = turn(opened(), [{ act: 'objection', id: 'dont_need_antibiotics' }]);
    expect(names(offered.moves)).toEqual(['offer:products']);
    expect(names(turn(offered.state, [no]).moves)).toEqual(['end:end_call:not_interested']);
  });

  it('a yes to the other products is interest', () => {
    const { state } = turn(opened(), [{ act: 'objection', id: 'dont_need_antibiotics' }]);
    const after = turn(state, [yes]);
    expect(after.state.interest).toBe('yes');
    expect(names(after.moves)).toEqual(['offer:connect']);
  });
});

describe('"okay" is never a yes (call 99)', () => {
  it('said to her question: the question again, briefly - interest still unknown', () => {
    const { state, moves } = turn(opened(), [{ act: 'backchannel' }]);
    expect(names(moves)).toEqual(['return_to:interest']);
    expect(state.interest).toBe('unknown');
  });

  it('twice in a row: she does not ask it a third time - she listens', () => {
    const { state } = turn(opened(), [{ act: 'backchannel' }]);
    expect(turn(state, [{ act: 'backchannel' }]).moves).toEqual([]);
  });
});

describe('questions', () => {
  it('an approved answer is said word for word, then the offer it leads to - a person with someone free', () => {
    const { moves } = turn(opened(), [asking('price')]);
    expect(moves[0]).toEqual({ move: 'answer', id: 'price', text: 'Prices depend on the medication and quantity.', again: false });
    expect(names(moves)).toEqual(['answer:price', 'return_to:interest']);
  });

  it('with her question answered, the answer\'s own offer follows - and with nobody free, never a person (calls 111, 112)', () => {
    const ctx = context('nobody');
    const { state } = turn(opened(ctx), [{ act: 'not_now' }], ctx);
    // The call back declined is not offered again; nor a person, with nobody there: the link.
    const declined = turn(state, [{ act: 'declines' }, asking('price')], ctx);
    expect(names(declined.moves)).toEqual(['end:end_call:not_interested']);
    const answered = turn(turn(opened(ctx), [{ act: 'backchannel' }], ctx).state, [asking('price')], ctx);
    expect(names(answered.moves)).toEqual(['answer:price', 'offer:callback']);
  });

  it('asked again: briefly, in her words - not the same sentence twice', () => {
    let { state } = turn(opened(), [asking('shipping')]);
    const { moves } = turn(state, [asking('shipping')]);
    expect(names(moves)[0]).toBe('answer:shipping:again');
    state = markSaid(state, moves);
    expect(state.answered.shipping).toBe(2);
  });

  it('a question no answer covers: our specialists can tell them - asked again, the same in new words, never "I can\'t provide that" (call 111)', () => {
    const ctx = context('nobody');
    let { state, moves } = turn(opened(ctx), [asking(UNCOVERED)], ctx);
    expect(names(moves)).toEqual(['specialist', 'return_to:interest']);
    ({ state, moves } = turn(state, [asking(UNCOVERED)], ctx));
    expect(names(moves)).toEqual(['specialist:again', 'offer:callback']);
    expect(moves.some((m) => m.move === 'offer' && m.kind === 'connect')).toBe(false);
    expect(state.wantsSpecialist).toBe(true);
  });

  it('a person is offered once: a question after it is answered, the offer not made again (call 90)', () => {
    let { state, moves } = turn(opened(), [{ act: 'backchannel' }]);
    ({ state, moves } = turn(state, [asking(UNCOVERED)]));
    expect(names(moves)).toEqual(['specialist', 'offer:connect']);
    ({ state, moves } = turn(state, [asking('price')]));
    expect(names(moves)).toEqual(['answer:price', 'return_to:offer_connect']);
    ({ moves } = turn(state, [asking('shipping')]));
    expect(names(moves)).toEqual(['answer:shipping', 'anything_else']);
    expect(moves.some((m) => m.move === 'offer')).toBe(false);
  });

  it('her open question is come back to once, not after every side question (call 94)', () => {
    let { state, moves } = turn(opened(), [asking('shipping')]);
    expect(names(moves)).toEqual(['answer:shipping', 'return_to:interest']);
    ({ state, moves } = turn(state, [asking('tracking')]));
    expect(names(moves)).toEqual(['answer:tracking', 'anything_else']);
    ({ state, moves } = turn(state, [asking('discreet')]));
    expect(names(moves)).toEqual(['answer:discreet', 'return_to:interest']);
    // Never the same question two replies running.
    ({ moves } = turn(state, [asking('ship_where')]));
    expect(names(moves)).toEqual(['answer:ship_where', 'anything_else']);
  });

  it('two questions at once: both answered, then one question', () => {
    const { moves } = turn(opened(), [asking('price'), asking('states')]);
    expect(names(moves)).toEqual(['answer:price', 'answer:states', 'return_to:interest']);
  });

  it('"Are you a real person?" - her virtual assistant answer, then a person offered', () => {
    let { state } = turn(opened(), [{ act: 'backchannel' }]);
    const { moves } = turn(state, [asking(REAL_PERSON)]);
    expect(names(moves)).toEqual(['virtual', 'offer:connect']);
    state = markSaid(state, moves);
  });

  it('"Anything else?" - "No": with interest shown, a person; with none shown, the offer again; after a no, goodbye', () => {
    const asked = (ctx = context()) => {
      let state = opened(ctx);
      state = { ...state, open: 'anything_else', askedAnythingElse: true };
      return state;
    };
    expect(names(turn({ ...asked(), interest: 'yes' }, [no]).moves)).toEqual(['offer:connect']);
    expect(names(turn(asked(), [no]).moves)).toEqual(['return_to:interest']);
    expect(names(turn({ ...asked(), interest: 'no', offers: { ...asked().offers, connect: { made: 1, answer: 'no' } } }, [no]).moves)).toEqual([
      'end:end_call:other',
    ]);
  });
});

describe('objections', () => {
  it('the client\'s own answers are said word for word - the scam answer, the pharmacy, how we got their number', () => {
    expect(names(turn(opened(), [{ act: 'objection', id: 'scam' }]).moves)).toEqual(['answer:scam', 'return_to:interest']);
    expect(names(turn(opened(), [{ act: 'objection', id: 'too_expensive' }]).moves)[0]).toBe('answer:cheaper_pharmacy');
    expect(names(turn(opened(), [{ act: 'objection', id: 'never_signed_up' }]).moves)[0]).toBe('answer:how_got_number');
  });

  it('"I already have a doctor" - worded from its approach', () => {
    expect(names(turn(opened(), [{ act: 'objection', id: 'have_doctor' }]).moves)).toEqual(['objection:have_doctor', 'return_to:interest']);
  });

  it('"I\'m busy" - when would suit; "I need to think about it" - the link', () => {
    expect(names(turn(opened(), [{ act: 'objection', id: 'busy' }]).moves)).toEqual(['ask_time']);
    expect(names(turn(opened(), [{ act: 'objection', id: 'think_about_it' }]).moves)).toEqual(['offer:link']);
  });

  it('"Not interested" said as the objection is a no', () => {
    expect(names(turn(opened(), [{ act: 'objection', id: 'not_interested' }]).moves)).toEqual(['ask_why']);
  });
});

describe('a call back - the time worked out by code, said back, booked only after a yes', () => {
  const lead = (now = WEDNESDAY_NOON) => context('nobody', now);

  it('"Call me tomorrow" - what time tomorrow; "two" - said back; "yes" - booked for that time', () => {
    const ctx = lead();
    let { state, moves } = turn(opened(ctx), [{ act: 'wants_callback', time: { day: 'tomorrow', hour: null, minute: null, ampm: null } }], ctx);
    expect(moves).toEqual([{ move: 'ask_time', day: 'tomorrow' }]);
    ({ state, moves } = turn(state, [{ act: 'wants_callback', time: { day: null, hour: 2, minute: null, ampm: null } }], ctx));
    expect(moves).toEqual([
      {
        move: 'confirm_time',
        at: '2026-11-12T21:00:00.000Z',
        zone: 'America/Phoenix',
        spoken: 'tomorrow at 2 PM your time',
        instead: null,
        asked: null,
      },
    ]);
    ({ moves } = turn(state, [yes], ctx));
    expect(moves).toEqual([
      {
        move: 'end',
        handoff: { action: 'book_callback', at: '2026-11-12T21:00:00.000Z', timeZone: 'America/Phoenix', reason: 'Asked for a call back.' },
      },
    ]);
  });

  it('"How about Sunday?" - a day the team does not work: refused at once, and what time on Monday asked; "noon" - Monday at 12 said back (call 122)', () => {
    const ctx = lead();
    const day = (d: string | null, hour: number | null = null) => ({ act: 'wants_callback' as const, time: { day: d, hour, minute: null, ampm: null } });
    let { state, moves } = turn(opened(ctx), [day('sunday')], ctx);
    expect(moves).toEqual([{ move: 'ask_time', day: 'monday', instead: { asked: 'Sunday', why: 'closed_day' } }]);
    ({ state, moves } = turn(state, [day(null, 12)], ctx));
    expect(moves).toMatchObject([{ move: 'confirm_time', at: '2026-11-16T19:00:00.000Z', spoken: 'Monday at 12 PM your time', instead: null }]);
  });

  it('"later today" after the hours are over: refused - what time tomorrow; a working day with time left is asked as before', () => {
    const evening = lead(new Date('2026-11-12T01:00:00Z')); // Wednesday 6 PM in Arizona
    const today = { act: 'wants_callback' as const, time: { day: 'today', hour: null, minute: null, ampm: null } };
    expect(turn(opened(evening), [today], evening).moves).toEqual([{ move: 'ask_time', day: 'tomorrow', instead: { asked: 'today', why: 'none_left' } }]);
    const noon = lead();
    expect(turn(opened(noon), [today], noon).moves).toEqual([{ move: 'ask_time', day: 'today' }]);
  });

  it('Saturday asked on a Friday evening: Monday is next - a day word the next time said is read against', () => {
    const friday = lead(new Date('2026-11-14T01:00:00Z')); // Friday 6 PM in Arizona
    const saturday = { act: 'wants_callback' as const, time: { day: 'saturday', hour: null, minute: null, ampm: null } };
    const { state, moves } = turn(opened(friday), [saturday], friday);
    // Asked on a Friday, Saturday is "tomorrow" - as she would say it.
    expect(moves).toEqual([{ move: 'ask_time', day: 'monday', instead: { asked: 'tomorrow', why: 'closed_day' } }]);
    expect(state.callback.day).toBe('monday');
  });

  it('never booked without being said back first (call 92): a time given goes to "So that\'s...?"', () => {
    const ctx = lead();
    const { moves } = turn(opened(ctx), [{ act: 'wants_callback', time: { day: 'tomorrow', hour: 12, minute: null, ampm: 'pm' } }], ctx);
    expect(names(moves)).toEqual(['confirm_time']);
    expect(moves.some((m) => m.move === 'end')).toBe(false);
  });

  it('"Tomorrow at two" on a Friday - a Saturday: the nearest time that can be booked, Monday at 2, offered instead (call 93)', () => {
    const ctx = lead(FRIDAY_AFTERNOON);
    const { moves } = turn(opened(ctx), [{ act: 'wants_callback', time: { day: 'tomorrow', hour: 2, minute: null, ampm: 'pm' } }], ctx);
    expect(moves[0]).toMatchObject({ move: 'confirm_time', instead: 'outside_hours', spoken: 'Monday at 2 PM your time', asked: 'tomorrow at 2 PM your time' });
  });

  it('8 PM - outside the hours: the next opening offered instead', () => {
    const ctx = lead();
    const { moves } = turn(opened(ctx), [{ act: 'wants_callback', time: { day: null, hour: 8, minute: null, ampm: 'pm' } }], ctx);
    expect(moves[0]).toMatchObject({ move: 'confirm_time', instead: 'outside_hours', spoken: 'tomorrow at 11 AM your time' });
  });

  it('a yes to the time said back read as asking for the call back again: booked all the same', () => {
    const ctx = lead();
    const { state } = turn(opened(ctx), [{ act: 'wants_callback', time: { day: 'tomorrow', hour: 3, minute: null, ampm: 'pm' } }], ctx);
    expect(turn(state, [{ act: 'wants_callback', time: null }], ctx).moves).toMatchObject([{ move: 'end', handoff: { action: 'book_callback', at: '2026-11-12T22:00:00.000Z' } }]);
  });

  it('"When would suit?" - "I don\'t want to talk": a no to the call back - with a no before it, the call ends (call 127)', () => {
    const offered = turn(opened(), [{ act: 'not_now' }]).state;
    const asked = turn(offered, [yes]);
    expect(names(asked.moves)).toEqual(['ask_time']);
    expect(names(turn(asked.state, [no]).moves)).toEqual(['end:end_call:not_interested']);
  });

  it('"When would suit?" - "No" with interest shown and nobody free: the link instead, once', () => {
    const ctx = context('nobody');
    const asked = turn(opened(ctx), [{ act: 'interested' }], ctx);
    expect(names(asked.moves)).toEqual(['busy', 'ask_time']);
    const { state, moves } = turn(asked.state, [no], ctx);
    expect(names(moves)).toEqual(['offer:link']);
    expect(names(turn(state, [no], ctx).moves)).toEqual(['end:end_call:not_interested']);
  });

  it('a no to the time said back: when would suit, asked again', () => {
    const ctx = lead();
    const { state } = turn(opened(ctx), [{ act: 'wants_callback', time: { day: 'tomorrow', hour: 3, minute: null, ampm: 'pm' } }], ctx);
    const after = turn(state, [no], ctx);
    expect(names(after.moves)).toEqual(['ask_time']);
    expect(after.state.callback.proposed).toBeNull();
  });

  it('in the lead\'s own zone: 2 PM New York time is 12 PM in Arizona', () => {
    const ctx = context('nobody', WEDNESDAY_NOON, 'America/New_York');
    const { moves } = turn(opened(ctx), [{ act: 'wants_callback', time: { day: 'tomorrow', hour: 2, minute: null, ampm: 'pm' } }], ctx);
    expect(moves[0]).toMatchObject({ move: 'confirm_time', at: '2026-11-12T19:00:00.000Z', zone: 'America/New_York', instead: null });
  });

  it('a question about their health: the approved answer, then a person offered first - with nobody there, a call back (call 130)', () => {
    for (const topic of ['medical_question', 'which_medication']) {
      expect(names(turn(opened(), [asking(topic)]).moves)).toEqual([`answer:${topic}`, 'offer:connect']);
      const ctx = context('nobody');
      expect(names(turn(opened(ctx), [asking(topic)], ctx).moves)).toEqual([`answer:${topic}`, 'offer:callback']);
    }
    // A yes to it is a yes to the person - put through.
    const { state } = turn(opened(), [asking('medical_question')]);
    expect(names(turn(state, [yes]).moves)).toEqual(['end:transfer_to_agent']);
  });

  it('the reason booked with it comes from the record: a specialist\'s question', () => {
    const ctx = lead();
    let state = turn(opened(ctx), [asking('medical_question')], ctx).state;
    state = turn(state, [{ act: 'wants_callback', time: { day: 'tomorrow', hour: 3, minute: null, ampm: 'pm' } }], ctx).state;
    const { moves } = turn(state, [yes], ctx);
    expect(moves[0]).toMatchObject({ move: 'end', handoff: { action: 'book_callback', reason: 'Has a question for a specialist.' } });
  });
});

describe('the link', () => {
  it('asked for: sent, the call ends', () => {
    expect(names(turn(opened(), [{ act: 'wants_link' }]).moves)).toEqual(['end:send_link']);
  });

  it('a yes to her offer of it: sent', () => {
    const { state } = turn(opened(), [{ act: 'objection', id: 'think_about_it' }]);
    expect(names(turn(state, [yes]).moves)).toEqual(['end:send_link']);
  });

  it('"I want to look myself" after the why - read as not now as well: the link, not a call back; a yes sends it (call 127)', () => {
    const why = turn(opened(), [no]).state;
    const { state, moves } = turn(why, [{ act: 'not_now' }, { act: 'objection', id: 'think_about_it' }]);
    expect(names(moves)).toEqual(['offer:link']);
    expect(names(turn(state, [yes]).moves)).toEqual(['end:send_link']);
  });

  it('offering it is not sending it: no action until they say yes (call 89)', () => {
    const { moves } = turn(opened(), [{ act: 'objection', id: 'think_about_it' }]);
    expect(moves.some((m) => m.move === 'end')).toBe(false);
  });
});

describe('misheard lines', () => {
  it('once: asked to say it again; twice: a simpler choice, the link; three times: goodbye', () => {
    let { state, moves } = turn(opened(), [{ act: 'unclear' }]);
    expect(names(moves)).toEqual(['ask_repeat']);
    ({ state, moves } = turn(state, [{ act: 'unclear' }]));
    expect(names(moves)).toEqual(['offer:link']);
    ({ moves } = turn(state, [{ act: 'unclear' }]));
    expect(names(moves)).toEqual(['end:end_call:other']);
  });

  it('a line understood puts it right', () => {
    let { state } = turn(opened(), [{ act: 'unclear' }]);
    state = turn(state, [asking('shipping')]).state;
    expect(state.misheard).toBe(0);
  });
});

describe('first, whatever else was said', () => {
  it('a stop: opted out, at once', () => {
    expect(names(turn(opened(), [asking('price'), { act: 'stop' }]).moves)).toEqual(['end:opt_out']);
  });

  it('an emergency: the emergency answer, then the end', () => {
    expect(names(turn(opened(), [{ act: 'emergency' }]).moves)).toEqual(['answer:emergency', 'end:end_call:emergency']);
  });

  it('a voicemail greeting: she says nothing, and listens on - the beep decides (A18, A23)', () => {
    expect(turn(opened(), [{ act: 'machine' }]).moves).toEqual([]);
  });
});

describe('the three minutes', () => {
  it('the closing offer with her next reply - a person with someone free, a call back with nobody; then an ending', () => {
    let state = wrapUpDue(turn(opened(), [{ act: 'backchannel' }]).state);
    let moves: Move[];
    ({ state, moves } = turn(state, [asking('shipping')]));
    expect(names(moves)).toEqual(['answer:shipping', 'offer:connect']);
    expect(state.wrapUp).toBe('offered');
    ({ moves } = turn(state, [{ act: 'other' }]));
    expect(names(moves)).toEqual(['end:end_call:other']);

    const nobody = context('nobody');
    const due = wrapUpDue(turn(opened(nobody), [{ act: 'backchannel' }], nobody).state);
    expect(names(turn(due, [{ act: 'other' }], nobody).moves)).toEqual(['offer:callback']);
  });
});

describe('the shape of a reply', () => {
  it('at most one question, and last; an ending asks nothing', () => {
    for (const acts of [[asking('price'), asking('shipping'), asking('states')], [{ act: 'emergency' } as Act], [{ act: 'interested' } as Act]]) {
      const { moves } = turn(opened(), acts);
      expect(moves.filter(asks).length).toBeLessThanOrEqual(1);
      const question = moves.findIndex(asks);
      if (question >= 0) expect(question).toBe(moves.length - 1);
      if (moves.some((m) => m.move === 'end')) expect(moves.some(asks)).toBe(false);
    }
  });
});

describe('what she said', () => {
  it('talked over: only the moves the lead heard count - an offer cut off was never made', () => {
    const decision = decide(opened(), [asking(UNCOVERED)], context());
    expect(names(decision.moves)).toEqual(['specialist', 'return_to:interest']);
    const heard = markSaid(decision.state, decision.moves.slice(0, 1));
    expect(heard.specialist).toBe(1);
    expect(heard.returned).toBe(false);
  });

  it('how her last two replies began, kept for the next', () => {
    let state = markOpening(startState(), 'Totally fair, John.');
    state = markOpening(state, 'Great - I can help.');
    state = markOpening(state, 'Sure thing.');
    expect(state.openings).toEqual(['Great -', 'Sure thing']);
  });
});

describe('resolveTime - a time said on the lead\'s clock', () => {
  const zone = 'America/Phoenix';
  it.each<[string, Parameters<typeof resolveTime>[0], string]>([
    ['"two" - the afternoon', { day: 'tomorrow', hour: 2, minute: null, ampm: null }, '2026-11-12T21:00:00.000Z'],
    ['"nine" - the morning', { day: 'tomorrow', hour: 9, minute: null, ampm: null }, '2026-11-12T16:00:00.000Z'],
    ['"twelve" - noon', { day: 'tomorrow', hour: 12, minute: null, ampm: null }, '2026-11-12T19:00:00.000Z'],
    ['"3:30 PM today"', { day: 'today', hour: 3, minute: 30, ampm: 'pm' }, '2026-11-11T22:30:00.000Z'],
    ['"Monday at 11"', { day: 'monday', hour: 11, minute: null, ampm: 'am' }, '2026-11-16T18:00:00.000Z'],
    ['"Wednesday at 3" on a Wednesday at noon - today', { day: 'wednesday', hour: 3, minute: null, ampm: 'pm' }, '2026-11-11T22:00:00.000Z'],
    ['"Wednesday at 10 AM" on a Wednesday at noon - next week', { day: 'wednesday', hour: 10, minute: null, ampm: 'am' }, '2026-11-18T17:00:00.000Z'],
    ['no day, a time still ahead - today', { day: null, hour: 4, minute: null, ampm: 'pm' }, '2026-11-11T23:00:00.000Z'],
    ['no day, a time gone - tomorrow', { day: null, hour: 10, minute: null, ampm: 'am' }, '2026-11-12T17:00:00.000Z'],
    ['a date', { day: '2026-11-19', hour: 1, minute: null, ampm: 'pm' }, '2026-11-19T20:00:00.000Z'],
  ])('%s', (_, said, iso) => {
    expect(resolveTime(said, zone, WEDNESDAY_NOON)?.toISOString()).toBe(iso);
  });

  it('nothing it can read: null', () => {
    expect(resolveTime({ day: 'someday', hour: 2, minute: null, ampm: null }, zone, WEDNESDAY_NOON)).toBeNull();
    expect(resolveTime({ day: 'tomorrow', hour: null, minute: null, ampm: null }, zone, WEDNESDAY_NOON)).toBeNull();
    expect(resolveTime({ day: 'tomorrow', hour: 2, minute: 75, ampm: null }, zone, WEDNESDAY_NOON)).toBeNull();
  });
});

describe('the edges', () => {
  it('the closing offer with a person and a call back both turned down: the link', () => {
    const base = opened();
    const state = wrapUpDue({
      ...base,
      offers: { ...base.offers, connect: { made: 1, answer: 'no' }, callback: { made: 1, answer: 'no' } },
      returned: true,
    });
    expect(names(turn(state, [{ act: 'other' }]).moves)).toEqual(['offer:link']);
  });

  it('a no with the why already asked, and no door left open: goodbye', () => {
    const state = { ...opened(), whyAsked: true };
    expect(names(turn(state, [{ act: 'not_interested', reason: null }]).moves)).toEqual(['end:end_call:not_interested']);
  });

  it('a day it cannot read: when would suit, asked again', () => {
    const ctx = context('nobody');
    const { moves, state } = turn(opened(ctx), [{ act: 'wants_callback', time: { day: 'someday', hour: 2, minute: null, ampm: null } }], ctx);
    expect(moves).toEqual([{ move: 'ask_time', day: null }]);
    expect(state.callback.day).toBeNull();
  });

  it('hours that allow no call back at all: the link instead - and with the link turned down, goodbye', () => {
    const ctx = { ...context('nobody'), hours: { ...DEFAULT_CALL_HOURS, days: new Set<never>() } };
    const said = { act: 'wants_callback' as const, time: { day: 'tomorrow', hour: 2, minute: null, ampm: null } };
    expect(names(turn(opened(ctx), [said], ctx).moves)).toEqual(['offer:link']);
    const base = opened(ctx);
    const noLink = { ...base, offers: { ...base.offers, link: { made: 1, answer: 'no' as const } } };
    expect(names(turn(noLink, [said], ctx).moves)).toEqual(['end:end_call:other']);
  });

  it('"I need to think about it" with the link already turned down: answered and carried on, not offered again', () => {
    const base = opened();
    const state = { ...base, offers: { ...base.offers, link: { made: 1, answer: 'no' as const } } };
    const { moves } = turn(state, [{ act: 'objection', id: 'think_about_it' }]);
    expect(moves.some((m) => m.move === 'offer' && m.kind === 'link')).toBe(false);
  });

  it('nothing understood but other words: one question to go on with', () => {
    expect(names(turn(opened(), [{ act: 'other' }]).moves)).toEqual(['return_to:interest']);
  });
});
