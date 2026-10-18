/**
 * The automated call's script - pure. docs/AUTO-CALLS.md, migration 015.
 *
 * The shape of a script as `db/call-script.ts` loads it. What the call does
 * after each answer is added here in T8; understanding an answer is
 * `matchSpokenChoice` in `core/answers.ts` (T7).
 */

/** How the script ends on a choice. */
export type CallEnding = 'transfer' | 'send_link' | 'declined';

export interface CallChoice {
  /** The key that picks it: '1', '2'. Never '9' - that is stop. */
  key: string;
  /** What the screens show for it: 'Yes'. */
  label: string;
  /** What may be said for it, found as whole words inside the sentence. */
  words: readonly string[];
  /** Said on this answer, before the next step or the end. */
  reply: string;
  /** Where it leads - null when it ends. */
  nextStepId: number | null;
  /** How the script ends - null when it leads on. Exactly one of the two is set. */
  ending: CallEnding | null;
}

export interface CallStep {
  id: number;
  /** 'q1', 'q2'. */
  key: string;
  /** The lowest is asked first. Numbered in tens. */
  position: number;
  /** What the screens call it: 'Offer'. */
  heading: string;
  /** What is said. */
  body: string;
  /** Said when the answer is not understood the first time - asks for keys. */
  repeatBody: string;
  choices: readonly CallChoice[];
}

export interface CallScript {
  id: number;
  key: string;
  name: string;
  /** The voice Twilio speaks it in. */
  voice: string;
  /** Any of these said, or the key 9, on any step: stop, and block the number. */
  optOutWords: readonly string[];
  optOutBody: string;
  /** Said, and the call ended, when a step is not understood twice. */
  noResponseBody: string;
  /** Left after the beep. `{callback_number}` is read out digit by digit. */
  voicemailBody: string;
  /** Nobody took a "yes", and nobody is about to be free. */
  busyBody: string;
  /** Nobody took a "yes" yet, but someone is on a call. */
  holdBody: string;
  /** Texted on a "yes" to the link. */
  linkText: string;
  /** In order: the first is asked first. */
  steps: readonly CallStep[];
}

/** The key that stops the calls, on any step. */
export const OPT_OUT_KEY = '9';
