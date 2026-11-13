/**
 * How Seri sounds - the tone she gives a sentence - found on A21's real calls,
 * docs/AI-AGENT.md section 1, "Her tone". Pure.
 *
 * ElevenLabs's v4 model takes a direction in square brackets inside the words
 * - "[friendly] No problem at all." - and says what follows that way:
 * brighter, calmer, more understanding. The brackets are not said. Seri writes them, as her
 * instructions say ("How you sound", instructions.ts); this keeps only the
 * tones on `TONES` and drops every other bracket before Twilio gets the text -
 * a direction she made up, or the who-is-there note read back - since the
 * voice can say an unknown one aloud.
 *
 * The tone is how a line is said, not what: the call's record (`call_ai_turns`),
 * the timeline and the safety check get her words alone (`spokenWords`).
 */

/**
 * The tones she may use and when - one list for her instructions and for the
 * check. Heard on the dev number, 2026-11-13, on Aria: tones against the same
 * lines plain, then on a real call. Businesslike on purpose: "softly" and
 * "warmly" made "No worries, Jeel" and "let me know when you're ready" sound
 * breathy and personal on that call (89-90), so they are not on the list.
 */
export const TONES: readonly { tag: string; when: string }[] = [
  { tag: '[friendly]', when: 'hello, thanks and goodbye' },
  { tag: '[friendly, upbeat]', when: 'saying who you are and the offer' },
  { tag: '[curious]', when: 'asking the lead something' },
  { tag: '[cheerfully]', when: 'good news - they said yes, a call back is booked, you are connecting them' },
  { tag: '[understanding]', when: 'they are busy, unwell, unsure or not interested' },
  { tag: '[reassuring, calm]', when: 'they are worried, suspicious or upset, or it may be an emergency' },
  { tag: '[apologetic]', when: 'the wrong person, or a mistake on our side' },
];

/** Every word a tone may be made of: "[friendly, upbeat]" is two. */
const TONE_WORDS: ReadonlySet<string> = new Set(
  TONES.flatMap((t) =>
    t.tag
      .slice(1, -1)
      .split(',')
      .map((w) => w.trim())
  )
);

const BRACKETED = /\[([^\][]*)\]/g;

/** The tone in a bracket, written the one way - "friendly, upbeat" - or null when it is not one of ours. */
function approved(inside: string): string | null {
  const words = inside
    .toLowerCase()
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0 || words.length > 3 || !words.every((w) => TONE_WORDS.has(w))) return null;
  return words.join(', ');
}

/** Spaces made single, none before a comma or a stop. */
const collapse = (text: string) =>
  text
    .replace(/\s+([,.?!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/** A bracket left open or closed alone is dropped, never said. */
const stray = (text: string) => text.replace(/[[\]]/g, ' ');

/** What the voice is sent: her words with our tones only, every other bracket dropped. */
export function withTone(text: string): string {
  const parts: string[] = [];
  let from = 0;
  for (const match of text.matchAll(BRACKETED)) {
    const tone = approved(match[1]);
    parts.push(stray(text.slice(from, match.index)), tone ? `[${tone}]` : '');
    from = (match.index ?? 0) + match[0].length;
  }
  parts.push(stray(text.slice(from)));
  return collapse(parts.join(' '));
}

/** What the lead hears, and what is kept on record: her words, no brackets at all. */
export function spokenWords(text: string): string {
  return collapse(stray(text.replace(BRACKETED, ' ')));
}

/** The brackets she wrote that are not our tones - for the answer test set (A09). */
export function strayBrackets(text: string): string[] {
  return [...text.matchAll(BRACKETED)].filter((m) => !approved(m[1])).map((m) => m[0]);
}

/** Whether she gave the sentence a tone. */
export function hasTone(text: string): boolean {
  return [...text.matchAll(BRACKETED)].some((m) => approved(m[1]) !== null);
}

/** Her greeting as the voice is sent it - friendly - by Twilio, the moment the lead picks up (A13). */
export function greetingWithTone(greeting: string): string {
  return `[friendly] ${greeting}`;
}
