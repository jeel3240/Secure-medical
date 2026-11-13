import { greetingWithTone, hasTone, spokenWords, strayBrackets, TONES, withTone } from './tone';

describe('her tone, sent to the voice (withTone)', () => {
  it('keeps every tone on the list, as written', () => {
    for (const { tag } of TONES) {
      expect(withTone(`${tag} Hello there.`)).toBe(`${tag} Hello there.`);
    }
  });

  it('keeps a tone in the middle of a sentence', () => {
    expect(withTone('Thanks so much for your time, Jeel, [cheerfully] and have a lovely day!')).toBe(
      'Thanks so much for your time, Jeel, [cheerfully] and have a lovely day!'
    );
  });

  it('writes a tone the one way, whatever the case or spacing', () => {
    expect(withTone('[Friendly] Hi.')).toBe('[friendly] Hi.');
    expect(withTone('[ friendly ,upbeat ] Hi.')).toBe('[friendly, upbeat] Hi.');
    expect(withTone('[upbeat, friendly] Hi.')).toBe('[upbeat, friendly] Hi.');
  });

  it('drops a tone not on the list, which the voice could say aloud', () => {
    expect(withTone('[laughs] That is a fair question.')).toBe('That is a fair question.');
    expect(withTone('[excited] Great!')).toBe('Great!');
    expect(withTone('[friendly, excited] Great!')).toBe('Great!');
    expect(withTone('[friendly, softly, calm] Great!')).toBe('Great!');
    expect(withTone('[friendly, reassuring, calm, curious] Great!')).toBe('Great!');
    expect(withTone('[friendly, reassuring, calm] Great!')).toBe('[friendly, reassuring, calm] Great!');
  });

  it('drops the soft tones that sounded personal on a real call (call 90)', () => {
    expect(withTone('[softly] No problem.')).toBe('No problem.');
    expect(withTone('[warmly] Thanks for your time.')).toBe('Thanks for your time.');
    expect(withTone('[sympathetic, softly] No problem.')).toBe('No problem.');
  });

  it('drops the who-is-there note read back, and any other bracket', () => {
    expect(withTone('[Who is there: someone free] Sure.')).toBe('Sure.');
    expect(withTone('Hi [first name], how are you?')).toBe('Hi, how are you?');
    expect(withTone('[] Hello.')).toBe('Hello.');
  });

  it('drops a bracket left open or closed alone', () => {
    expect(withTone('[friendly Hello.')).toBe('friendly Hello.');
    expect(withTone('Hello] there.')).toBe('Hello there.');
  });

  it('leaves a sentence with no tone as it is', () => {
    expect(withTone("I'll text you the link now. Have a great day!")).toBe("I'll text you the link now. Have a great day!");
  });
});

describe('her words, kept on record (spokenWords)', () => {
  it('takes every bracket out, ours or not', () => {
    expect(spokenWords('[friendly] No problem at all.')).toBe('No problem at all.');
    expect(spokenWords('Thanks, Jeel, [cheerfully] and have a lovely day!')).toBe('Thanks, Jeel, and have a lovely day!');
    expect(spokenWords('[laughs] Sure.')).toBe('Sure.');
    expect(spokenWords('[understanding] Oh, I understand. [curious] Would later work?')).toBe(
      'Oh, I understand. Would later work?'
    );
  });

  it('is empty for a tone alone', () => {
    expect(spokenWords('[friendly]')).toBe('');
    expect(spokenWords('  [laughs]  ')).toBe('');
  });
});

describe('what the answer test set checks', () => {
  it('names the brackets that are not our tones', () => {
    expect(strayBrackets('[friendly] Hi. [laughs] Sure. [Who is there: nobody] Okay.')).toEqual(['[laughs]', '[Who is there: nobody]']);
    expect(strayBrackets('[friendly, upbeat] Hi.')).toEqual([]);
  });

  it('says whether she gave a sentence a tone', () => {
    expect(hasTone('[curious] Is that something you would like?')).toBe(true);
    expect(hasTone('[laughs] Sure.')).toBe(false);
    expect(hasTone('Sure.')).toBe(false);
  });
});

describe('the greeting', () => {
  it('is said friendly, and its words are the greeting', () => {
    expect(greetingWithTone('Hi, is this John?')).toBe('[friendly] Hi, is this John?');
    expect(spokenWords(greetingWithTone('Hi there!'))).toBe('Hi there!');
  });
});
