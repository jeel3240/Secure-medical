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
}

/**
 * Lowercase, collapse whitespace, drop trailing punctuation, and strip a
 * leading "option" or "#" - so "1.", "Option 1" and "Yes!" all reach the
 * comparison as a bare answer.
 */
export function normaliseReply(text: string): string {
  return (text ?? '')
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
 * sentence would read "no, I want to talk first" as No, and "I don't know
 * which one" as "know", so anything longer goes to the clarification and then
 * to a person.
 */
export function matchChoice<C extends MatchableChoice>(text: string, choices: readonly C[]): C | null {
  const cleaned = normaliseReply(text);
  if (!cleaned) return null;
  return (
    choices.find((c) => c.choice === cleaned) ??
    choices.find((c) => c.words.some((word) => normaliseReply(word) === cleaned)) ??
    null
  );
}

// Opt-out detection deliberately lives in api/webhooks.ts, not here. It is
// already built there and the state machine is told the outcome via
// `reply.optOut`, so there is only ever one keyword list.
