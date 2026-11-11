/**
 * The OpenAI model Seri thinks with, and how she is asked - Phase 7,
 * docs/AI-AGENT.md section 1. Chosen by the answer test set (A09, 2026-11-11):
 * of the small fast models, the one that passed most cases, then the quickest
 * to its first word. The relay (A11) and the test set (`evals/run.ts`) both
 * read it, so what is tested is what calls use.
 */

export const SERI_MODEL = 'gpt-4.1-mini';

/**
 * Sent with every request, so OpenAI keeps the instructions' shared first
 * part - the same on every call (A04) - ready for the next one.
 */
export const PROMPT_CACHE_KEY = 'seri-instructions';
