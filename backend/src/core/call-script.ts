/**
 * The automated call's script - pure. docs/AUTO-CALLS.md, migration 015.
 *
 * The shape of a script as `db/call-script.ts` loads it, and what the call
 * does next: `firstAsk` when the lead picks up, `afterAnswer` after each
 * answer (T8). Understanding an answer is `matchSpokenChoice` in
 * `core/answers.ts` (T7). No database and no Twilio here, so every path of the
 * script is tested on its own; the webhooks (T12 on) say what this decides.
 */

import type { SpokenMatch } from './answers';

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

/**
 * How an automated call's script ended - `calls.script_result`, migration 014.
 * Kept in step with that column's check.
 */
export type CallResult =
  | 'transferred'
  | 'transfer_missed'
  | 'link_sent'
  | 'not_interested'
  | 'opted_out'
  | 'no_response'
  | 'voicemail_left'
  | 'hung_up'
  | 'unanswered';

/** What the call does next. `say` is spoken in order, before anything else. */
export type CallAction =
  /**
   * Ask a step: say the lines - the step's own words, or the repeat line on a
   * second asking - then listen for the answer. `attempt` 2 is the last chance.
   */
  | { kind: 'ask'; step: CallStep; attempt: 1 | 2; say: string[] }
  /** A "yes": say the line, then ring people (T15). How it ends is decided there. */
  | { kind: 'transfer'; say: string[] }
  /**
   * Say the lines and hang up, with how the script ended. `sendLink`: text the
   * link once the call has its answer (T14). `blockNumber`: the lead said stop.
   * `brokenScript`: the script led nowhere it may - ended politely, and to be
   * logged as an error, since it is a mistake in our rows, not the lead's.
   */
  | {
      kind: 'end';
      say: string[];
      result: CallResult;
      sendLink?: true;
      blockNumber?: true;
      brokenScript?: true;
    };

/** The first thing said when the lead picks up: the first step's question. */
export function firstAsk(script: CallScript): CallAction {
  const first = script.steps[0];
  if (!first) return politeEnd(script);
  return { kind: 'ask', step: first, attempt: 1, say: [first.body] };
}

/** A call the script cannot carry on: thank them, end, and flag our mistake. */
function politeEnd(script: CallScript): CallAction {
  return { kind: 'end', say: [script.noResponseBody], result: 'no_response', brokenScript: true };
}

/**
 * What happens after the lead answered `stepId`, asked for the `attempt`th
 * time, and `matchSpokenChoice` read the answer as `match`.
 *
 * - **Stop** ends the call, on any step and any attempt, and blocks the number.
 * - **Not understood, or silence:** the first time, the step is asked again
 *   with its repeat line, which asks for keys; the second time the call ends,
 *   politely, as no response. The client's script: "repeat once, then end".
 * - **A choice:** its reply, then the next step - or its ending: a transfer,
 *   the link, or not interested.
 * - **A script that leads nowhere it may** - an unknown step, a next step that
 *   is missing or not later than this one - ends the call politely rather
 *   than loop or crash, marked `brokenScript`.
 */
export function afterAnswer(
  script: CallScript,
  stepId: number,
  attempt: 1 | 2,
  match: SpokenMatch<CallChoice>
): CallAction {
  const step = script.steps.find((s) => s.id === stepId);
  if (!step) return politeEnd(script);

  if (match.result === 'opt_out') {
    return { kind: 'end', say: [script.optOutBody], result: 'opted_out', blockNumber: true };
  }

  if (match.result === 'unclear' || match.result === 'silence') {
    return attempt === 1
      ? { kind: 'ask', step, attempt: 2, say: [step.repeatBody] }
      : { kind: 'end', say: [script.noResponseBody], result: 'no_response' };
  }

  const { choice } = match;
  switch (choice.ending) {
    case 'transfer':
      return { kind: 'transfer', say: [choice.reply] };
    case 'send_link':
      return { kind: 'end', say: [choice.reply], result: 'link_sent', sendLink: true };
    case 'declined':
      return { kind: 'end', say: [choice.reply], result: 'not_interested' };
  }

  const next = script.steps.find((s) => s.id === choice.nextStepId);
  // Only ever forward, so a script cannot send a lead round in circles.
  if (!next || next.position <= step.position) return politeEnd(script);
  return { kind: 'ask', step: next, attempt: 1, say: [choice.reply, next.body] };
}

/**
 * The `call_answers` row an answer becomes: what it was taken to mean, and for
 * a choice its key and label as they are now - kept, so renaming a choice
 * later never rewrites what an earlier lead said.
 */
export function answerRecord(match: SpokenMatch<CallChoice>): {
  result: 'choice' | 'opt_out' | 'unclear' | 'silence';
  choiceKey: string | null;
  choiceLabel: string | null;
} {
  return match.result === 'choice'
    ? { result: 'choice', choiceKey: match.choice.key, choiceLabel: match.choice.label }
    : { result: match.result, choiceKey: null, choiceLabel: null };
}
