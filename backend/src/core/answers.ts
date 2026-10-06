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

// Opt-out detection deliberately lives in api/webhooks.ts, not here. It is
// already built there and the state machine is told the outcome via
// `reply.optOut`, so there is only ever one keyword list.
