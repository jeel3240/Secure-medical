/**
 * Understanding a spoken answer on the automated call - T7, docs/AUTO-CALLS.md.
 *
 * The words are the script's own, through the fixture the live check holds to
 * the database, so these are the sentences a lead might really say to the
 * real questions.
 */
import { matchSpokenChoice, normaliseSpeech, type SpokenAnswer } from './answers';
import { OPT_OUT_KEY } from './call-script';
import { ANTIBIOTICS_CALL } from './call-script-fixtures';

const [OFFER, LINK] = ANTIBIOTICS_CALL.steps;
const RULES = { optOutWords: ANTIBIOTICS_CALL.optOutWords, optOutKey: OPT_OUT_KEY, minConfidence: 0.4 };

/** What a step's answer is taken to mean, in one word. */
function meaning(step: typeof OFFER, answer: SpokenAnswer): string {
  const match = matchSpokenChoice(answer, step.choices, RULES);
  return match.result === 'choice' ? match.choice.label : match.result;
}
const said = (heard: string, confidence: number | null = 0.9): SpokenAnswer => ({ heard, confidence });

describe('a spoken yes or no', () => {
  it.each(['Yes.', 'Yes, I am.', 'Yeah sure', 'yes please', 'Okay', 'Sure, why not', "Of course I'm interested", 'yep'])(
    '"%s" is Yes',
    (text) => expect(meaning(OFFER, said(text))).toBe('Yes')
  );

  it.each(['No.', "No, I'm not interested.", 'not interested', 'Nope', 'No thank you', 'not today', 'nah not really'])(
    '"%s" is No',
    (text) => expect(meaning(OFFER, said(text))).toBe('No')
  );

  it('"not interested" is No, never Yes because of "interested" inside it - the longer phrase wins', () => {
    expect(meaning(OFFER, said("I'm really not interested"))).toBe('No');
  });

  it('the same word on another step means that step\'s choice', () => {
    expect(meaning(LINK, said('Sure, send it'))).toBe('Yes');
    expect(meaning(LINK, said('text me'))).toBe('Yes');
    expect(meaning(LINK, said("Don't text me"))).toBe('No');
    expect(meaning(LINK, said('no text please'))).toBe('No');
  });
});

describe('what is not one answer', () => {
  it.each(['yes no', 'maybe', 'what is this about', 'who is this', 'not really interested', 'hello?'])(
    '"%s" is unclear - asked again, for keys',
    (text) => expect(meaning(OFFER, said(text))).toBe('unclear')
  );

  it('nothing said and nothing pressed is silence', () => {
    expect(meaning(OFFER, {})).toBe('silence');
    expect(meaning(OFFER, { heard: '   ', digits: '' })).toBe('silence');
  });

  it('a long sentence is not an answer to a yes-or-no question', () => {
    expect(meaning(OFFER, said(`yes ${'and I would like to know '.repeat(20)}`))).toBe('unclear');
  });
});

describe('keys', () => {
  it('a key pressed wins - keys are never misheard', () => {
    expect(meaning(OFFER, { digits: '1' })).toBe('Yes');
    expect(meaning(OFFER, { digits: '2' })).toBe('No');
    // Whatever was heard as well, and however unsure.
    expect(meaning(OFFER, { digits: '1', heard: 'no', confidence: 0.1 })).toBe('Yes');
  });

  it('9 is stop, on every step', () => {
    expect(meaning(OFFER, { digits: '9' })).toBe('opt_out');
    expect(meaning(LINK, { digits: '9' })).toBe('opt_out');
  });

  it('any other key is unclear', () => {
    for (const digits of ['3', '0', '*', '#']) expect(meaning(OFFER, { digits })).toBe('unclear');
  });

  it('a number said on its own counts as that key - "one", "1", and how Twilio may hear them', () => {
    expect(meaning(OFFER, said('one'))).toBe('Yes');
    expect(meaning(OFFER, said('1.'))).toBe('Yes');
    expect(meaning(OFFER, said('Two'))).toBe('No');
    expect(meaning(OFFER, said('to'))).toBe('No');
    expect(meaning(OFFER, said('won'))).toBe('Yes');
    expect(meaning(OFFER, said('nine'))).toBe('opt_out');
  });

  it('but only on its own: "I need to think" is not a 2', () => {
    expect(meaning(OFFER, said('I need to think'))).toBe('unclear');
  });
});

describe('stop', () => {
  it.each(['Stop calling me', 'stop', 'Please remove me from your list', 'take me off', 'Do not call me again', "don't call me", 'unsubscribe'])(
    '"%s" is stop',
    (text) => expect(meaning(OFFER, said(text))).toBe('opt_out')
  );

  it('wins over anything else said', () => {
    expect(meaning(OFFER, said('No, stop calling me'))).toBe('opt_out');
    expect(meaning(LINK, said('yes but stop calling'))).toBe('opt_out');
  });

  it('even when Twilio is unsure - missing a real stop is worse than ending one call', () => {
    expect(meaning(OFFER, said('stop calling me', 0.2))).toBe('opt_out');
  });
});

describe('how sure Twilio was', () => {
  it('below the threshold, a yes is not trusted', () => {
    expect(meaning(OFFER, said('yes', 0.21))).toBe('unclear');
    expect(meaning(OFFER, said('yes', 0.39))).toBe('unclear');
  });

  it('at or above it, it is', () => {
    expect(meaning(OFFER, said('yes', 0.4))).toBe('Yes');
    expect(meaning(OFFER, said('yes', 0.92))).toBe('Yes');
  });

  it('no figure, or 0, is not held against the answer - some speech models send none', () => {
    expect(meaning(OFFER, said('yes', null))).toBe('Yes');
    expect(meaning(OFFER, { heard: 'yes' })).toBe('Yes');
    expect(meaning(OFFER, said('yes', 0))).toBe('Yes');
  });
});

describe('normaliseSpeech', () => {
  it('lowercases and turns everything that is not a letter or digit into one space', () => {
    expect(normaliseSpeech("Don't text me!")).toBe('don t text me');
    expect(normaliseSpeech('  Yes,   I am.  ')).toBe('yes i am');
  });

  it('is empty for nothing, and for a sentence too long to be an answer', () => {
    expect(normaliseSpeech(null)).toBe('');
    expect(normaliseSpeech('   ')).toBe('');
    expect(normaliseSpeech('a'.repeat(301))).toBe('');
  });
});
