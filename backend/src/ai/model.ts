/**
 * The OpenAI models Seri's brain uses, and how they are asked - Phase 7,
 * docs/AI-AGENT.md sections 1 and 12. Each request names a cache key, so
 * OpenAI keeps the part that is the same on every call ready for the next.
 */

/**
 * The model she speaks with - the speak step (A29). Chosen by the answer test
 * set (A09, 2026-11-11) for today's brain, of the small fast models the one
 * that passed most cases, then the quickest to its first word; measured again
 * for speaking by A24.
 */
export const SERI_MODEL = 'gpt-4.1-mini';

/**
 * The model the new brain's understand step uses (A24, A28): the fastest of
 * eight to a whole answer, 0.71 s median, asked without reasoning.
 */
export const UNDERSTAND_MODEL = 'gpt-5.4-mini';
export const UNDERSTAND_EFFORT = 'none' as const;
export const UNDERSTAND_CACHE_KEY = 'seri-understand';

/** Her persona for the speak step (A29) - the same on every call, kept read. */
export const SPEAK_CACHE_KEY = 'seri-speak';
