/**
 * Matching a lead's reply to one of the choices of the question they were
 * asked. Pure: no database, no network.
 *
 * The choices, and the words each accepts, come from the flow
 * (`flow_choices`, docs/FLOWS.md) - until 2026-10-05 they were a fixed list
 * here, three per question.
 */

/** A choice as far as matching goes: what the lead types, and the words that mean the same. */
export interface MatchableChoice {
  /** '1', '2', '3'. */
  choice: string;
  /** Accepted as the whole reply, any case: `yes`, `y`, `yeah`. */
  words: readonly string[];
  /** What the screens call it - 'Talk to an agent'. Accepted too: it is the option as the lead read it. */
  label?: string;
}

/**
 * An answer is a number or a few words. Anything longer is a sentence, which
 * is never matched (see matchChoice) - and is not even cleaned up, so a very
 * long message costs nothing to turn down.
 */
const MAX_ANSWER_LENGTH = 80;

/**
 * Lowercase, with everything that is not a letter or a digit turned into a
 * single space, and a leading "option" dropped - so "1.", "(1)", "Option 1",
 * "Yes!", "yes 👍" and "No, thanks" all reach the comparison as a bare answer.
 * Empty for a message too long to be one.
 */
export function normaliseReply(text: string): string {
  const raw = (text ?? '').trim();
  if (raw.length > MAX_ANSWER_LENGTH) return '';
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^option /, '');
}

/** Every worded form of one choice: its accepted words, and its label. */
function wordsOf(c: MatchableChoice): string[] {
  return [...c.words, ...(c.label ? [c.label] : [])].map(normaliseReply).filter(Boolean);
}

/**
 * The choice the reply names, or null if it is anything else.
 *
 * The whole message must be one of the accepted forms:
 *
 * - the number: `2`
 * - one of the choice's words, or its label: `no`, `talk to an agent`
 * - the option as it was printed, number first: `1. Yes`, `2) Talk to an agent
 *   for options & discounts` - the number, then text that begins with a word
 *   of that same choice. `1 no` names two different choices and matches
 *   neither.
 *
 * Matching inside a sentence would read "no, I want to talk first" as No, and
 * "I don't know which one" as "know", so anything else goes to the
 * clarification and then to a person.
 */
export function matchChoice<C extends MatchableChoice>(text: string, choices: readonly C[]): C | null {
  const cleaned = normaliseReply(text);
  if (!cleaned) return null;

  const byNumber = choices.find((c) => c.choice === cleaned);
  if (byNumber) return byNumber;

  const byWord = choices.find((c) => wordsOf(c).includes(cleaned));
  if (byWord) return byWord;

  return (
    choices.find((c) => {
      const prefix = `${c.choice} `;
      if (!cleaned.startsWith(prefix)) return false;
      const rest = cleaned.slice(prefix.length);
      return wordsOf(c).some((word) => rest === word || rest.startsWith(`${word} `));
    }) ?? null
  );
}

// Opt-out detection for SMS deliberately lives in api/webhooks.ts, not here.
// It is already built there and the state machine is told the outcome via
// `reply.optOut`, so there is only ever one keyword list. The automated call's
// stop words are the script's own (`call_scripts.opt_out_words`) and are
// matched below.

// --- A spoken answer, on the automated call (T7, docs/AUTO-CALLS.md) ---------

/** What Twilio sent back for one asking of a step. */
export interface SpokenAnswer {
  /** What Twilio heard - its `SpeechResult`. Empty or absent when nothing was said. */
  heard?: string | null;
  /** The keys pressed - its `Digits`. */
  digits?: string | null;
  /** How sure Twilio was of what it heard, 0 to 1. Absent when it sent no figure. */
  confidence?: number | null;
}

/** A choice as far as a spoken answer goes: its key, and what may be said for it. */
export interface SpeakableChoice {
  /** '1', '2' - the key that picks it. */
  key: string;
  /** Found as whole words inside the sentence: `yes`, `not interested`. */
  words: readonly string[];
}

export type SpokenMatch<C> =
  | { result: 'choice'; choice: C }
  /** Stop: the number is to be blocked. */
  | { result: 'opt_out' }
  /** Something was said or pressed, and it is not one answer - or Twilio was unsure. */
  | { result: 'unclear' }
  /** Nothing said, nothing pressed. */
  | { result: 'silence' };

/** A sentence longer than this is not an answer to a yes-or-no question. */
const MAX_SPOKEN_LENGTH = 300;

/**
 * A number said on its own, as Twilio may write it down: the word, or a word
 * that sounds the same - "to" for two, "won" for one. Only ever the whole
 * answer, so "I need to think" is never a 2.
 */
const NUMBER_WORDS: Readonly<Record<string, string>> = {
  zero: '0', one: '1', won: '1', two: '2', to: '2', too: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

/**
 * Lowercase words, with everything that is not a letter or a digit a single
 * space - the same cleaning `normaliseReply` does, so "Don't text me!" and the
 * stored phrase "don't text" both become `don t text`. Empty when nothing was
 * said, or when it is too long to be an answer.
 */
export function normaliseSpeech(text: string | null | undefined): string {
  const raw = (text ?? '').trim();
  if (!raw || raw.length > MAX_SPOKEN_LENGTH) return '';
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Which phrases occur in the sentence, longest first, each word used once: so
 * in "no I'm not interested" the No phrase `not interested` takes those two
 * words, and the Yes word `interested` finds nothing left to match.
 */
function phrasesFound<T>(words: readonly string[], phrases: readonly { tokens: string[]; owner: T }[]): Set<T> {
  const used = words.map(() => false);
  const found = new Set<T>();
  const longestFirst = [...phrases].sort((a, b) => b.tokens.length - a.tokens.length);
  for (const { tokens, owner } of longestFirst) {
    for (let i = 0; i + tokens.length <= words.length; i++) {
      const fits = tokens.every((t, k) => words[i + k] === t && !used[i + k]);
      if (!fits) continue;
      tokens.forEach((_, k) => (used[i + k] = true));
      found.add(owner);
    }
  }
  return found;
}

const toPhrases = <T>(list: readonly string[], owner: T) =>
  list
    .map(normaliseSpeech)
    .filter(Boolean)
    .map((p) => ({ tokens: p.split(' '), owner }));

/**
 * What a spoken or keyed answer to one step means. Pure.
 *
 * In this order:
 *
 * 1. **A key pressed wins** - keys are never misheard. The stop key (9) is
 *    stop; a choice's key is that choice; any other key is unclear.
 * 2. **A number said on its own** - "one", "1" - counts as that key: the
 *    repeat line asks people to press one, and some say it instead.
 * 3. **Stop words win over anything else said** - "no, stop calling me" is
 *    stop. Even when Twilio is unsure: wrongly ending one call loses that
 *    call, while missing a real "stop" calls someone who asked not to be.
 * 4. **A doubtful hearing is unclear** - a confidence below `minConfidence`.
 *    The step is asked again, for keys. No figure, or 0, is not held against
 *    it: some speech models send none (AUTO-CALLS.md, "Understanding an
 *    answer").
 * 5. **The choices' words, found inside the sentence**, longest phrase first.
 *    Exactly one choice found is that choice; none, or two - "yes no" - is
 *    unclear.
 *
 * Unlike an SMS reply (`matchChoice`), a sentence is searched: people say
 * "yes I am" and "yeah sure", not "1".
 */
export function matchSpokenChoice<C extends SpeakableChoice>(
  answer: SpokenAnswer,
  choices: readonly C[],
  rules: { optOutWords: readonly string[]; optOutKey: string; minConfidence: number }
): SpokenMatch<C> {
  const byKey = (key: string): SpokenMatch<C> => {
    if (key === rules.optOutKey) return { result: 'opt_out' };
    const choice = choices.find((c) => c.key === key);
    return choice ? { result: 'choice', choice } : { result: 'unclear' };
  };

  const digits = (answer.digits ?? '').trim();
  if (digits) return byKey(digits);

  const spoken = normaliseSpeech(answer.heard);
  if (!spoken) return (answer.heard ?? '').trim() ? { result: 'unclear' } : { result: 'silence' };

  const words = spoken.split(' ');
  if (words.length === 1) {
    const key = /^\d$/.test(words[0]) ? words[0] : NUMBER_WORDS[words[0]];
    if (key) return byKey(key);
  }

  if (phrasesFound(words, toPhrases(rules.optOutWords, 'stop')).size > 0) return { result: 'opt_out' };

  const { confidence } = answer;
  if (typeof confidence === 'number' && confidence > 0 && confidence < rules.minConfidence) {
    return { result: 'unclear' };
  }

  const found = phrasesFound(
    words,
    choices.flatMap((c) => toPhrases(c.words, c))
  );
  if (found.size !== 1) return { result: 'unclear' };
  return { result: 'choice', choice: [...found][0] };
}
