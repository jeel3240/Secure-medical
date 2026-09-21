/**
 * Matching a lead's reply to one of the three options for the question they
 * were asked. Pure: no database, no network.
 *
 * The word lists are fixed here rather than in `settings`. If the client wants
 * to edit them they move, like the message copy - see STATE-MACHINE.md.
 */

export type Choice = '1' | '2' | '3';

/**
 * Accepted words per question, at most three per option. From
 * STATE-MACHINE.md, "A valid answer to the current question".
 */
const WORDS: Record<1 | 2 | 3, Record<Choice, string[]>> = {
  1: {
    '1': ['supplements', 'supplement'],
    '2': ['telehealth', 'rx'],
    '3': ['both'],
  },
  2: {
    '1': ['today'],
    '2': ['this week', 'week'],
    '3': ['researching'],
  },
  3: {
    '1': ['call', 'call me'],
    '2': ['text', 'text me'],
    '3': ['later'],
  },
};

/**
 * Lowercase, collapse whitespace, drop trailing punctuation, and strip a
 * leading "option" or "#" - so "1.", "Option 1" and "Supplements!" all reach
 * the comparison as a bare answer.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/, '')
    .replace(/^(option|#)\s*/, '')
    .trim();
}

/**
 * The choice the reply names, or null if it is anything else.
 *
 * The whole message must be one of the accepted forms. Matching inside a
 * sentence would read "not today" as today, and "I don't want supplements" as
 * supplements, so anything longer goes to a human instead.
 */
export function matchAnswer(text: string, step: number): Choice | null {
  if (step !== 1 && step !== 2 && step !== 3) return null;

  const cleaned = normalise(text ?? '');
  if (!cleaned) return null;

  if (cleaned === '1' || cleaned === '2' || cleaned === '3') {
    return cleaned as Choice;
  }

  for (const [choice, words] of Object.entries(WORDS[step])) {
    if (words.includes(cleaned)) return choice as Choice;
  }

  return null;
}

// Opt-out detection deliberately lives in api/webhooks.ts, not here. It is
// already built there and the state machine is told the outcome via
// `reply.optOut`, so there is only ever one keyword list.
