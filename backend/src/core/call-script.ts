/**
 * The automated call's script - pure. docs/AUTO-CALLS.md, migration 015.
 *
 * The shape of a script as `db/call-script.ts` loads it, and what the call
 * does next: `firstAsk` when the lead picks up, `afterAnswer` after each
 * answer (T8), and `handleAnswer`, which adds what only a live call has - a
 * lead who hung up (T13). Understanding an answer is `matchSpokenChoice` in
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
  /** A "yes": say the line, then ring people - `planTransfer` (T15a). How it ends is decided there. */
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

/** An action that is only words and listening - everything but a transfer. */
export type AskOrEnd = Extract<CallAction, { kind: 'ask' | 'end' }>;

/** A "yes" that is to reach a person, before who rings is known - `planTransfer`. */
export type TransferAction = Extract<CallAction, { kind: 'transfer' }>;

/** The first thing said when the lead picks up: the first step's question. Never a transfer. */
export function firstAsk(script: CallScript): AskOrEnd {
  const first = script.steps[0];
  if (!first) return politeEnd(script);
  return { kind: 'ask', step: first, attempt: 1, say: [first.body] };
}

/** A call the script cannot carry on: thank them, end, and flag our mistake. */
function politeEnd(script: CallScript): AskOrEnd {
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

/** The `call_answers` row an answer becomes - `answerRecord`. */
export type AnswerRecord = ReturnType<typeof answerRecord>;

/**
 * What `/auto/gather` does with one answer - T13. Pure: the route reads the
 * request, carries this out, and says `next`.
 */
export interface AnswerOutcome {
  /** The `call_answers` row to keep. Null when there is nothing to keep, or no step to keep it under. */
  answer: AnswerRecord | null;
  /** How the script ended, to save once. Null while it goes on, or when the lead left before it could end. */
  result: CallResult | null;
  /** The lead said stop: block the number. */
  blockNumber: boolean;
  /** The lead asked for the link: text it (T14). */
  sendLink: boolean;
  /** A mistake in our rows, not the lead's: to be logged as an error. */
  brokenScript: boolean;
  /**
   * What to say next: words, or a transfer still to be planned against who is
   * free (`planTransfer`). Null when the lead has hung up - there is nobody to
   * say it to.
   */
  next: AskOrEnd | TransferAction | null;
}

/**
 * What happens after the lead answered `stepId`, asked for the `attempt`th
 * time, and `matchSpokenChoice` read the answer as `match` - `afterAnswer`,
 * with three things only a live call has:
 *
 * - **The lead may have hung up** (`hungUp`): Twilio still asks `/auto/gather`
 *   after a hang-up - found on the first real call, T12. With nothing said,
 *   nothing is kept: it is a hang-up, never silence to ask again about. With
 *   something said, it counts - a stop still blocks, a yes to the link is
 *   still texted - but nothing that needs them on the line happens, and
 *   ending for want of an answer is not their result: the call's end saves
 *   `hung_up` instead.
 * - **A "yes" to a transfer** is handed on as it is: who rings depends on who
 *   is free at that moment, which only the database knows - `planTransfer`
 *   (T15a). Said as the lead hung up, it reaches nobody: the call's end saves
 *   `hung_up`.
 * - An answer to a step this script does not have is not kept: there is no
 *   step to keep it under.
 */
export function handleAnswer(
  script: CallScript,
  stepId: number,
  attempt: 1 | 2,
  match: SpokenMatch<CallChoice>,
  hungUp: boolean
): AnswerOutcome {
  const none: AnswerOutcome = {
    answer: null,
    result: null,
    blockNumber: false,
    sendLink: false,
    brokenScript: false,
    next: null,
  };
  if (hungUp && match.result === 'silence') return none;

  const answer = script.steps.some((s) => s.id === stepId) ? answerRecord(match) : null;
  const action = afterAnswer(script, stepId, attempt, match);

  if (action.kind === 'ask') return { ...none, answer, next: hungUp ? null : action };

  if (action.kind === 'transfer') return { ...none, answer, next: hungUp ? null : action };

  return {
    answer,
    result: hungUp && action.result === 'no_response' ? null : action.result,
    blockNumber: Boolean(action.blockNumber),
    sendLink: Boolean(action.sendLink),
    brokenScript: Boolean(action.brokenScript),
    next: hungUp ? null : action,
  };
}

/**
 * An asking's lines, split for listening - found on the first real calls
 * (T13): people answer as a question ends, often over its last word, and an
 * answer begun while nothing was listening was lost.
 *
 * `leadIn` - every line but the last, and the last line's sentences but its
 * final one - is said first, with nothing listening, so a "Hello?" over the
 * greeting is never taken as the answer. `question`, the final sentence, is
 * said with listening on, so an answer that starts before it ends is heard.
 */
export function splitForListening(lines: readonly string[]): { leadIn: string[]; question: string } {
  const last = lines[lines.length - 1] ?? '';
  const sentences = last.split(/(?<=[.!?])\s+/).filter(Boolean);
  const question = sentences.pop() ?? '';
  const leadIn = [...lines.slice(0, -1), ...(sentences.length > 0 ? [sentences.join(' ')] : [])];
  return { leadIn, question };
}

/** At most this many people ring at once - Twilio's limit on `<Client>`s in one `<Dial>`. */
export const MAX_RUNG_AT_ONCE = 10;

/** What a "yes" to a transfer becomes once who is free is known - `planTransfer`. */
export type TransferPlan =
  /** Say the lines, then ring these people together; the first to accept takes the lead. */
  | { kind: 'ring'; say: string[]; agentIds: number[] }
  | Extract<AskOrEnd, { kind: 'end' }>;

/**
 * What a "yes" to a transfer becomes - T15a, AUTO-CALLS.md "The transfer".
 *
 * - **A machine answered the phone** (Twilio's verdict, when it has come):
 *   nobody is rung - a voicemail greeting is not a lead saying yes. Ended
 *   politely, as no response; T18 leaves the voicemail message instead.
 * - **Nobody free**: the line, then the busy line - `transfer_missed`, so an
 *   agent calls the lead back (T22 puts them first in the queue).
 * - **Otherwise** the line, then the free people rung together, at most
 *   `MAX_RUNG_AT_ONCE`, in the order given. Who takes it, or that nobody did,
 *   is decided when the ringing ends.
 */
export function planTransfer(
  script: CallScript,
  transfer: TransferAction,
  opts: { free: readonly number[]; machine: boolean }
): TransferPlan {
  if (opts.machine) return { kind: 'end', say: [script.noResponseBody], result: 'no_response' };
  if (opts.free.length === 0) {
    return { kind: 'end', say: [...transfer.say, script.busyBody], result: 'transfer_missed' };
  }
  return { kind: 'ring', say: [...transfer.say], agentIds: opts.free.slice(0, MAX_RUNG_AT_ONCE) };
}
