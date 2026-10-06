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
  ])('%j -> %j', (raw, cleaned) => {
    expect(normaliseReply(raw)).toBe(cleaned);
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
