/**
 * How a speak reply is marked - A29. Pure.
 *
 * Her words as the lead hears them - tones taken out, each sentence through
 * the safety check - hold one of each `mustSay` group and none of
 * `mustNotSay` nor the words she must never say; a reply that ends the call
 * asks nothing, any other asks at most one question, last.
 */

import { checkSentence } from '../safety';
import { SentenceSplitter } from '../sentences';
import { spokenWords, strayBrackets } from '../tone';
import { says } from './grade';
import type { SpeakCase } from './speak-cases';

/** Never, in any reply. */
export const NEVER_SAY = ["i don't know", "can't answer", "can't provide", "cannot provide", "don't have that information", 'no worries', 'take your time', '$', 'dollars'];

export function gradeSpeak(c: SpeakCase, reply: string): { pass: boolean; problems: string[] } {
  const problems: string[] = [];
  const words = spokenWords(reply);
  for (const bracket of strayBrackets(reply)) problems.push(`not one of her tones: [${bracket}]`);
  if (!words) problems.push('said nothing');
  for (const group of c.mustSay ?? []) if (!group.some((w) => says(words, w))) problems.push(`says none of: ${group.join(' / ')}`);
  for (const w of [...NEVER_SAY, ...(c.mustNotSay ?? [])]) if (says(words, w)) problems.push(`says "${w}"`);
  if (c.who === 'nobody' && /\bconnect(ing)? you\b/i.test(words) && !c.ending) problems.push('offers to connect them with nobody free');

  const splitter = new SentenceSplitter();
  const sentences = [...splitter.push(words), ...splitter.flush()].map((s) => s.trim()).filter(Boolean);
  const questions = sentences.filter((s) => s.includes('?'));
  if (c.ending && questions.length) problems.push(`asks something in a last line: ${questions[0]}`);
  if (!c.ending && questions.length > 1) problems.push(`asks ${questions.length} questions`);
  if (questions.length === 1 && !sentences[sentences.length - 1].includes('?')) problems.push('her question is not the last thing she says');
  if (c.asks && questions.length === 0) problems.push('asks nothing');
  for (const s of sentences) {
    const check = checkSentence(s);
    if (check.reason) problems.push(`would be replaced (${check.reason}): ${s}`);
  }
  return { pass: problems.length === 0, problems };
}
