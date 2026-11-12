/**
 * Seri's streamed reply, cut into sentences - A11. Each is checked and sent the
 * moment it is whole.
 */
import { SentenceSplitter } from './sentences';

/** Feeds `parts` one at a time, as OpenAI writes them; what came out after each, then at the end. */
function feed(parts: string[]): { after: string[][]; last: string[] } {
  const splitter = new SentenceSplitter();
  const after = parts.map((p) => splitter.push(p));
  return { after, last: splitter.flush() };
}

describe('cutting a streamed reply into sentences', () => {
  it('a sentence is out as soon as the space after it arrives', () => {
    expect(feed(['Sure', '.', ' What', ' time works?'])).toEqual({
      after: [[], [], ['Sure.'], []],
      last: ['What time works?'],
    });
  });

  it('several in one piece, each ending in . ? or !', () => {
    expect(feed(['Great! It ships to your home. Want the link? Okay'])).toEqual({
      after: [['Great!', 'It ships to your home.', 'Want the link?']],
      last: ['Okay'],
    });
  });

  it('a closing quote or bracket stays with its sentence', () => {
    expect(feed(['She said "yes." Then (later.) we called. '])).toEqual({
      after: [['She said "yes."', 'Then (later.)', 'we called.']],
      last: [],
    });
  });

  it('"Dr.", "a.m." and the like end no sentence', () => {
    expect(feed(['Dr. Lee can call at 9 a.m. your time. ', 'Mr. ', 'Smith too, e.g. ', 'today.'])).toEqual({
      after: [['Dr. Lee can call at 9 a.m. your time.'], [], [], []],
      last: ['Mr. Smith too, e.g. today.'],
    });
  });

  it('a number with a point is not an end', () => {
    expect(feed(['Up to 25.5 percent. Sure.'])).toEqual({ after: [['Up to 25.5 percent.']], last: ['Sure.'] });
  });

  it('"..." ends one; a newline counts as a space', () => {
    expect(feed(['Hmm... let me see.\nOkay.'])).toEqual({ after: [['Hmm...', 'let me see.']], last: ['Okay.'] });
  });

  it('nothing written, or only spaces: nothing out', () => {
    expect(feed([])).toEqual({ after: [], last: [] });
    expect(feed(['  '])).toEqual({ after: [[]], last: [] });
  });
});
