import { matchChoice, normaliseReply } from './answers';
import { ANTIBIOTICS } from './flow-fixtures';

const [q1, , q3, offers] = ANTIBIOTICS.questions;
const picked = (text: string, question = q1) => matchChoice(text, question.choices)?.choice ?? null;

describe('a reply, cleaned up before it is compared', () => {
  it.each([
    ['1.', '1'],
    ['  Yes!  ', 'yes'],
    ['Option 2', '2'],
    ['#1', '1'],
    ['LEARN   MORE', 'learn more'],
    ['(1)', '1'],
    ['1)', '1'],
    ['1. Yes', '1 yes'],
    ['yes 👍', 'yes'],
    ['No, thanks', 'no thanks'],
  ])('%j -> %j', (raw, cleaned) => {
    expect(normaliseReply(raw)).toBe(cleaned);
  });

  it('a message too long to be an answer is not cleaned at all, however it is built', () => {
    const started = Date.now();
    expect(normaliseReply('!'.repeat(90_000))).toBe('');
    expect(normaliseReply(`yes ${'please '.repeat(40)}`)).toBe('');
    // It used to take seconds: a run of punctuation was scanned once per character.
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('the option as the lead read it', () => {
  it('the number with its own word after it, as printed: "1. Yes"', () => {
    expect(picked('1. Yes')).toBe('1');
    expect(picked('2) no')).toBe('2');
    expect(picked('(2) No.')).toBe('2');
    expect(picked('2. Talk to an agent for options & discounts', q3)).toBe('2');
    expect(picked('1. I know which antibiotic I need', q3)).toBe('1');
    expect(picked('3 order online', q3)).toBe('3');
  });

  it('the choice\'s name alone', () => {
    expect(picked('Talk to an agent', q3)).toBe('2');
    expect(picked('I know which antibiotic', q3)).toBe('1');
    expect(picked('Special offers', offers)).toBe('1');
  });

  it('a number with another choice\'s word names two answers, so neither', () => {
    expect(picked('1 no')).toBeNull();
    expect(picked('2 yes')).toBeNull();
    expect(picked('1 or 2')).toBeNull();
    expect(picked('1 2')).toBeNull();
  });

  it('the polite forms', () => {
    expect(picked('Yes please')).toBe('1');
    expect(picked('No, thank you.')).toBe('2');
    expect(picked('yes 👍')).toBe('1');
  });
});

describe('matching a reply to a choice', () => {
  it('the number, or any of the choice\'s words, in any case', () => {
    expect(picked('1')).toBe('1');
    expect(picked('yes')).toBe('1');
    expect(picked('YEAH!')).toBe('1');
    expect(picked('2')).toBe('2');
    expect(picked('Nope.')).toBe('2');
  });

  it('only the choices this question has: Q1 has no third', () => {
    expect(picked('3')).toBeNull();
    expect(picked('3', q3)).toBe('3');
  });

  it('the whole reply must be the answer - a sentence is not one', () => {
    expect(picked('no, I want to talk to someone first')).toBeNull();
    expect(picked("I don't know which one", q3)).toBeNull();
    expect(picked('yes please call me tomorrow')).toBeNull();
  });

  it('the same word means different things on different questions', () => {
    // "yes" is choice 1 of Q1 and choice 1 of the offers question; "call" is
    // an answer only on Q3.
    expect(picked('call')).toBeNull();
    expect(picked('call', q3)).toBe('2');
    expect(picked('learn more', offers)).toBe('2');
    expect(picked('more', offers)).toBe('2');
    expect(picked('learn more')).toBeNull();
  });

  it('nothing, or nothing useful, is no answer', () => {
    expect(picked('')).toBeNull();
    expect(picked('   ')).toBeNull();
    expect(picked('?')).toBeNull();
  });
});
