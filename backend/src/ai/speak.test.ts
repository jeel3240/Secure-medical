/**
 * Speak (A29): what she is told for each reply - without OpenAI. How well she
 * words it is `npm run ai:eval:speak`.
 */
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { loadKnowledge } from './knowledge';
import { startState, markOpening, type Move } from './policy';
import { answerLine, moveBrief, needsSpeak, replyBrief, speakMessages, speakSystem, spokenMoves } from './speak';
import { TONES } from './tone';

const knowledge = loadKnowledge();
const setup = { knowledge, lead: { firstName: 'John', phone: '+14805551234' }, now: new Date('2026-11-11T19:00:00Z'), hours: DEFAULT_CALL_HOURS };

describe('her persona', () => {
  const system = speakSystem(setup);

  it('who she is, that what she does is decided for her, how she speaks and sounds, what she never does, and the call', () => {
    expect(system).toContain("You are Seri, eDrugstore's virtual assistant");
    expect(system).toContain('What you do next has already been decided');
    for (const tone of TONES) expect(system).toContain(tone.tag);
    for (const rule of knowledge.rules) expect(system).toContain(rule);
    expect(system).toContain("The lead's first name: John.");
  });

  it('holds no approved answer, objection example or action - those come with each reply, or not at all', () => {
    expect(system).not.toContain('Prices depend on the medication');
    expect(system).not.toContain('transfer_to_agent');
    expect(system).not.toContain('Would you like me to connect you with someone now to place your order?');
  });
});

describe('the brief for each move', () => {
  const brief = (move: Move, who: 'free' | 'nobody' = 'free') => moveBrief(move, who, 'John');

  it('the opening: who she is and the offer, then the question', () => {
    expect(brief({ move: 'opening' })).toMatch(/Seri from eDrugstore.*25% off.*interested/);
  });

  it('an approved answer already said is not said again; asked again, said in new words', () => {
    expect(brief({ move: 'answer', id: 'price', text: 'Prices vary.', again: false })).toBe('You have just said: "Prices vary." - don\'t say it again.');
    expect(brief({ move: 'answer', id: 'price', text: 'Prices vary.', again: true })).toMatch(/in new words: "Prices vary."/);
  });

  it('the specialists: never "I don\'t have it" - and with nobody free, no offer to connect', () => {
    expect(brief({ move: 'specialist', again: true }, 'nobody')).toMatch(/never say you don't have it.*nobody is free/);
  });

  it('a time said back in exactly the words worked out - or, refused, why first and the time offered instead', () => {
    const at = { at: 'x', zone: 'America/Phoenix', spoken: 'Monday at 2 PM your time' };
    expect(brief({ move: 'confirm_time', ...at, instead: null, asked: null })).toContain('"Monday at 2 PM your time"');
    expect(brief({ move: 'confirm_time', ...at, instead: 'outside_hours', asked: 'tomorrow at 2 PM your time' })).toMatch(
      /They asked for tomorrow at 2 PM your time, but our team works only during the agent hours below\. Say why first/
    );
  });

  it('every ending a last line with no question', () => {
    for (const handoff of [
      { action: 'transfer_to_agent' as const },
      { action: 'send_link' as const },
      { action: 'book_callback' as const, at: 'x', timeZone: 'y', reason: 'z' },
      { action: 'end_call' as const, reason: 'not_interested' as const },
    ]) {
      expect(brief({ move: 'end', handoff })).toMatch(/no question|one short sentence/);
    }
  });

  it('every move has a brief', () => {
    const moves: Move[] = [
      { move: 'virtual' },
      { move: 'objection', id: 'have_doctor' },
      { move: 'ask_why' },
      { move: 'offer', kind: 'products' },
      { move: 'busy' },
      { move: 'ask_time', day: 'tomorrow' },
      { move: 'ask_repeat' },
      { move: 'still_here' },
      { move: 'return_to', open: 'interest' },
      { move: 'anything_else' },
    ];
    for (const m of moves) expect(brief(m).length).toBeGreaterThan(10);
    expect(brief({ move: 'ask_time', day: 'tomorrow' })).toContain('what time tomorrow');
  });
});

describe('one reply\'s brief', () => {
  it('the moves in order, the one question last - and with nobody free, never an offer to connect', () => {
    const text = replyBrief([{ move: 'busy' }, { move: 'ask_time', day: null }], startState(), 'nobody', 'John');
    expect(text).toMatch(/^Your reply now.*\n1\. Say plainly.*\n2\. Ask what time.*\nNobody on our team is free.*\nAt most one question/s);
  });

  it('an ending: no question in it', () => {
    expect(replyBrief([{ move: 'end', handoff: { action: 'send_link' } }], startState(), 'free', null)).toContain('This is your last line: no question in it.');
  });

  it('how her last replies began, so this one begins otherwise', () => {
    const state = markOpening(markOpening(startState(), 'Totally fair, John.'), 'Great - sure.');
    expect(replyBrief([{ move: 'anything_else' }], state, 'free', null)).toContain('Your last replies began "Totally fair" and "Great -" - begin this one differently.');
  });

  it('the messages: her persona, the last six turns, then the brief', () => {
    const recent = Array.from({ length: 8 }, (_, i) => ({ who: i % 2 ? ('lead' as const) : ('seri' as const), text: `t${i}` }));
    const messages = speakMessages('persona', recent, 'brief');
    expect(messages).toHaveLength(8);
    expect(messages[0]).toEqual({ role: 'system', content: 'persona' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 't2' });
    expect(messages[7]).toEqual({ role: 'system', content: 'brief' });
  });
});

describe('the approved answers, said by code', () => {
  it('in their tone, the client\'s words exactly, the number read out', () => {
    expect(answerLine('price', 'Prices depend on the medication and quantity.', 'four eight zero')).toBe('[friendly] Prices depend on the medication and quantity.');
    expect(answerLine('medical_question', 'That is for a provider.', 'x')).toBe('[reassuring, calm] That is for a provider.');
    expect(answerLine('customer_service', 'Call us at {callback_number}.', 'four eight zero')).toBe('[friendly] Call us at four eight zero.');
  });

  it('speak words the rest - an answer alone needs no speak', () => {
    const answer: Move = { move: 'answer', id: 'price', text: 'x', again: false };
    expect(spokenMoves([answer, { move: 'anything_else' }])).toEqual([{ move: 'anything_else' }]);
    expect(needsSpeak([answer])).toBe(false);
    expect(needsSpeak([{ ...answer, again: true }])).toBe(true);
  });
});
