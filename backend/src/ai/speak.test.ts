/**
 * Speak (A29): what she is told for each reply - without OpenAI. How well she
 * words it is `npm run ai:eval:speak`.
 */
import productsFile from './knowledge/products.json';
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { loadKnowledge } from './knowledge';
import { startState, markOpening, type Move } from './policy';
import { OPENING_LINE, answerLine, codeLines, moveBrief, needsSpeak, openingByCode, replyBrief, speakMessages, speakSystem, spokenMoves } from './speak';
import { checkSentence } from './safety';
import { SentenceSplitter } from './sentences';
import { TONES, spokenWords, strayBrackets } from './tone';

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

describe('no price, nor a product\'s web address, in anything she is told', () => {
  // Carried over from today's brain's instructions, removed 2026-11-19.
  it('her persona and every brief', () => {
    const prices = productsFile.products.map((p) => p.site_price_usd).filter((p): p is string => typeof p === 'string');
    expect(prices.length).toBeGreaterThan(0);
    const told = [speakSystem(setup), ...knowledge.answers.map((a) => replyBrief([{ move: 'answer', id: a.id, text: a.spoken, again: true }], startState(), 'free', 'John'))].join('\n');
    for (const price of prices) {
      expect(told).not.toContain(price);
      expect(told).not.toContain(price.replace(/\.00$/, ' dollars'));
    }
    expect(told).not.toContain('$');
    for (const product of productsFile.products) expect(told).not.toContain(product.url);
  });
});

describe('the brief for each move', () => {
  const brief = (move: Move, who: 'free' | 'nobody' = 'free') => moveBrief(move, who, 'John');

  it('the opening: who she is and the offer, then the question', () => {
    expect(brief({ move: 'opening' })).toMatch(/Seri from eDrugstore.*25% off.*interested/);
  });

  it('an approved answer already said is not said again; asked again, said in new words', () => {
    expect(brief({ move: 'answer', id: 'price', text: 'Prices vary.', again: false })).toMatch(/^You have just said: "Prices vary." - don't say it again, or any part of it/);
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
    expect(brief({ move: 'ask_time', day: 'monday' })).toContain('what time on Monday');
    // A day the team does not work, said alone (call 122): why first, then the next day - never a time on the day refused.
    const refused = brief({ move: 'ask_time', day: 'monday', instead: { asked: 'Sunday', why: 'closed_day' } });
    expect(refused).toContain('They asked for Sunday, but our team does not work that day');
    expect(refused).toContain('ask what time on Monday would suit them');
    expect(brief({ move: 'ask_time', day: '2026-11-30', instead: { asked: 'today', why: 'none_left' } })).toContain('on Monday, November 30');
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

  it('what code already said of this reply comes as her own words, tones taken out, before the brief - the question shown answered (calls 118-120)', () => {
    const recent = [{ who: 'lead' as const, text: 'How much is it?' }];
    const said = codeLines([{ move: 'answer', id: 'price', text: 'Prices depend on the medication and quantity.', again: false }, { move: 'return_to', open: 'interest' }], 'x');
    expect(said).toEqual(['[friendly] Prices depend on the medication and quantity.']);
    const messages = speakMessages('persona', recent, 'brief', said);
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'How much is it?' },
      { role: 'assistant', content: 'Prices depend on the medication and quantity.' },
      { role: 'system', content: 'brief' },
    ]);
    expect(speakMessages('persona', recent, 'brief', [])).toHaveLength(3);
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

describe('her introduction, saved (2026-11-18)', () => {
  const answer: Move = { move: 'answer', id: 'price', text: 'x', again: false };

  it('said by code when nothing else needs her words: a bare yes, or an approved answer and then the introduction', () => {
    expect(openingByCode([{ move: 'opening' }])).toBe(true);
    expect(needsSpeak([{ move: 'opening' }])).toBe(false);
    expect(openingByCode([answer, { move: 'opening' }])).toBe(true);
    expect(needsSpeak([answer, { move: 'opening' }])).toBe(false);
    expect(codeLines([answer, { move: 'opening' }], 'x')).toEqual(['[friendly] x', OPENING_LINE]);
  });

  it('worded by speak, with the rest, when anything else needs her words - her one question stays last', () => {
    const moves: Move[] = [{ move: 'specialist', again: false }, { move: 'opening' }];
    expect(openingByCode(moves)).toBe(false);
    expect(spokenMoves(moves)).toEqual(moves);
    expect(codeLines(moves, 'x')).toEqual([]);
    expect(openingByCode([{ ...answer, again: true }, { move: 'opening' }])).toBe(false);
    expect(openingByCode([answer])).toBe(false);
  });

  it('only her own tones, nothing the safety check would replace, one question - the last thing she says', () => {
    expect(strayBrackets(OPENING_LINE)).toEqual([]);
    const splitter = new SentenceSplitter();
    const sentences = [...splitter.push(spokenWords(OPENING_LINE)), ...splitter.flush()].map((x) => x.trim()).filter(Boolean);
    for (const sentence of sentences) expect(checkSentence(sentence).reason).toBeFalsy();
    expect(sentences.filter((x) => x.includes('?'))).toEqual([sentences[sentences.length - 1]]);
    expect(spokenWords(OPENING_LINE)).toMatch(/^This is Seri from eDrugstore, calling about our offer of up to 25% off your first order\./);
  });
});
