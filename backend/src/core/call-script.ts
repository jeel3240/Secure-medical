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
  /** Nobody took a "yes" yet, but someone is on a call, or writing the note of one. */
  holdBody: string;
  /** The lead's place, first in line - "You are next." (T16) */
  holdNextBody: string;
  /** The lead's place further back: `{place}` is the number - "You are number {place} in line." */
  holdPlaceBody: string;
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
  /**
   * Say the lines, then ring these people together; the first to accept takes
   * the lead. `holderFirst`: the one person rung is the lead's own agent, and
   * everyone else free is rung next if they do not take it (`planAfterHolder`).
   */
  | { kind: 'ring'; say: string[]; agentIds: number[]; holderFirst: boolean }
  /** Say the lines, then wait on hold: someone who takes transfers is on a call, or just off one (T16, T17). */
  | { kind: 'hold'; say: string[] }
  | Extract<AskOrEnd, { kind: 'end' }>;

/**
 * What a "yes" to a transfer becomes - AUTO-CALLS.md "The transfer".
 *
 * - **The lead's own agent is free** - `holder`, the agent holding the lead,
 *   among `free`: the line, then they ring alone first, as the lead's own
 *   agent (T15b). Not free, they are not waited for.
 * - **Nobody free**: the line, then - when someone who takes transfers is on a
 *   call or writing the note of one (`onCall`, `someoneOnOrJustOffCall`) - on
 *   hold (T16, T17); otherwise the busy line,
 *   `transfer_missed`, so an agent calls the lead back (T22 puts them first in
 *   the queue). `planNobodyTook`.
 * - **Otherwise** the line, then the free people rung together, at most
 *   `MAX_RUNG_AT_ONCE`, in the order given (T15a). Who takes it, or that
 *   nobody did, is decided when the ringing ends.
 *
 * A machine never gets here: its verdict hands the call to the voicemail
 * message, and no answer is taken after that (T18, `onVerdict`); a "machine"
 * verdict Twilio got wrong is ignored, so a person's yes still rings.
 */
export function planTransfer(
  script: CallScript,
  transfer: TransferAction,
  opts: { free: readonly number[]; holder: number | null; onCall: boolean }
): TransferPlan {
  if (opts.holder !== null && opts.free.includes(opts.holder)) {
    return { kind: 'ring', say: [...transfer.say], agentIds: [opts.holder], holderFirst: true };
  }
  if (opts.free.length === 0) return planNobodyTook(script, { say: transfer.say, onCall: opts.onCall });
  return { kind: 'ring', say: [...transfer.say], agentIds: opts.free.slice(0, MAX_RUNG_AT_ONCE), holderFirst: false };
}

/**
 * A "yes" nobody can take now - nobody free, or nobody took the ring - T16,
 * AUTO-CALLS.md "The hold line": `say`, then on hold while someone who takes
 * transfers is on a call, or writing the note of one that just ended
 * (`onCall`, `someoneOnOrJustOffCall` - T17), and so will be free soon;
 * otherwise the busy line - nobody is coming.
 */
export function planNobodyTook(
  script: CallScript,
  opts: { say?: readonly string[]; onCall: boolean }
): Extract<TransferPlan, { kind: 'hold' | 'end' }> {
  const say = [...(opts.say ?? [])];
  if (opts.onCall) return { kind: 'hold', say: [...say, script.holdBody] };
  return { kind: 'end', say: [...say, script.busyBody], result: 'transfer_missed' };
}

/**
 * Whether a lead waiting on hold waits on - T16, T17: while someone may yet
 * take them (`someoneComing` - never offered this lead, and on a call, just
 * off one, free, or being offered another), and for at most `maxSeconds` (the
 * safety stop).
 * Otherwise the busy line.
 */
export function holdGoesOn(opts: { waitedSeconds: number; maxSeconds: number; someoneComing: boolean }): boolean {
  return opts.someoneComing && opts.waitedSeconds < opts.maxSeconds;
}

/** A lead waiting on hold, as an offer is chosen - `pickOffer`. */
export interface WaitingLead {
  callId: number;
  /** Everyone this lead has been offered to already, however it ended. */
  offeredTo: readonly number[];
  /** Ringing someone right now. */
  offerLive: boolean;
}

/**
 * Who a waiting lead rings now - T17, AUTO-CALLS.md "The hold line": the lead
 * who has waited longest (`waiting` in that order), not already ringing
 * someone, rings the first free person (`free` in order) never offered that
 * lead - or only `only`, the person who has just come free. Null when there is
 * no such pair.
 */
export function pickOffer(
  waiting: readonly WaitingLead[],
  free: readonly number[],
  only: number | null = null
): { callId: number; agentId: number } | null {
  const people = only === null ? free : free.filter((id) => id === only);
  for (const lead of waiting) {
    if (lead.offerLive) continue;
    const agentId = people.find((id) => !lead.offeredTo.includes(id));
    if (agentId !== undefined) return { callId: lead.callId, agentId };
  }
  return null;
}

/** The lead's place in line, as said on hold - 1 is "You are next." (T16). */
export function placeLine(script: CallScript, place: number): string {
  return place <= 1 ? script.holdNextBody : script.holdPlaceBody.replace('{place}', String(place));
}

/**
 * The lead's own agent, rung alone first, let the transfer ring out - T15b:
 * everyone else free is rung together, at once, with nothing said first - the
 * lead has been listening to it ring. Not the agent who just let it ring.
 * Nobody else free: on hold or the busy line, as `planNobodyTook`.
 */
export function planAfterHolder(
  script: CallScript,
  opts: { free: readonly number[]; holder: number; onCall: boolean }
): TransferPlan {
  const others = opts.free.filter((id) => id !== opts.holder);
  if (others.length === 0) return planNobodyTook(script, { onCall: opts.onCall });
  return { kind: 'ring', say: [], agentIds: others.slice(0, MAX_RUNG_AT_ONCE), holderFirst: false };
}

/**
 * Who let a transfer's ring run out - T15c, AUTO-CALLS.md "Who is free":
 * their "Taking calls" switch goes off. Decided once the ringing is over, from
 * how the whole ring ended (`dialStatus`, Twilio's `DialCallStatus`):
 *
 * - **Taken, or the lead hung up while it rang**: nobody - the ring was not
 *   left to run out. (`hungUp`: the lead's call had ended by then.)
 * - **Every ring declined** (`busy`) or it failed: nobody - declining is a
 *   person who is there.
 * - **It ran out** (`no-answer`): one person rung - the lead's own agent,
 *   alone - is that person. Several: those whose own ring ran out, from
 *   `rings` (how each person's ring ended, by agent); not who declined. Not
 *   known, nobody.
 *
 * A person's own ring cannot decide it alone: Twilio reports a ring cut short
 * by someone else answering exactly as one that ran out - `no-answer` both,
 * found on a real call, 2026-10-20.
 */
export function rangOut(opts: {
  dialStatus: string;
  hungUp: boolean;
  rung: readonly number[];
  rings: ReadonlyMap<number, string> | null;
}): number[] {
  if (opts.hungUp || opts.dialStatus !== 'no-answer') return [];
  if (opts.rung.length === 1) return [...opts.rung];
  return opts.rung.filter((agentId) => opts.rings?.get(agentId) === 'no-answer');
}

/**
 * Twilio's verdict on who answered, as an automated call reads it - T18,
 * AUTO-CALLS.md "Voicemail". `beep`: a machine whose greeting has ended and
 * whose beep was heard (`machine_end_beep`). `machine`: a machine, but no beep
 * heard (`machine_end_silence`, `machine_end_other` - Twilio giving up after
 * its 30 seconds - or `machine_start`). `fax`. `person`: a person, or Twilio
 * not sure (`human`, `unknown`). Null for anything else.
 */
export type MachineVerdict = 'beep' | 'machine' | 'fax' | 'person';

export function machineVerdict(raw: unknown): MachineVerdict | null {
  if (raw === 'machine_end_beep') return 'beep';
  if (typeof raw === 'string' && raw.startsWith('machine')) return 'machine';
  if (raw === 'fax') return 'fax';
  if (raw === 'human' || raw === 'unknown') return 'person';
  return null;
}

/** The call as the verdict arrives - what `onVerdict` reads. */
export interface VerdictCall {
  /** The script has its result already, or the call is over. */
  ended: boolean;
  /** A person took the transfer and is on the call. */
  agentTook: boolean;
  /** A key was pressed - any key. Only a person presses keys. */
  keyPressed: boolean;
  /** The lead answered: a choice, said or pressed. */
  answered: boolean;
}

/** What a verdict does: the voicemail message, hanging up on a fax, or nothing. */
export type VerdictAction = 'voicemail' | 'hang_up' | 'carry_on';

/**
 * What Twilio's verdict does to a live automated call - T18, AUTO-CALLS.md
 * "Voicemail". Twilio is sometimes wrong: on a real transfer it called a
 * person who had said "Yes." a machine (call 24, `machine_end_other` after 30
 * seconds). And a greeting is sometimes heard as an answer - "Sorry, no one is
 * available" holds a "no". So the beep decides (Jeel, 2026-10-23):
 *
 * - **A person, or not sure**: the script carries on.
 * - **A person is on the call** - a key was pressed, or someone took the
 *   transfer: whatever Twilio says, it carries on.
 * - **The script has ended**, or the call: nothing to leave.
 * - **A beep heard**: the voicemail message - even after an "answer", which
 *   was the greeting talking. It stops a transfer still ringing, or a hold.
 * - **A machine, no beep heard**: the message only if the lead has answered
 *   nothing; after an answer, it carries on. A fax is hung up on, likewise.
 */
export function onVerdict(verdict: MachineVerdict, call: VerdictCall): VerdictAction {
  if (verdict === 'person' || call.ended || call.agentTook || call.keyPressed) return 'carry_on';
  if (verdict === 'beep') return 'voicemail';
  if (call.answered) return 'carry_on';
  return verdict === 'fax' ? 'hang_up' : 'voicemail';
}

/**
 * The voicemail message as said: `{callback_number}` - our number, E.164 -
 * read out digit by digit, in its groups: "4 8 0, 4 7 0, 8 2 5 9". A number
 * that is not a US one is read digit by digit, whole.
 */
export function voicemailLine(script: CallScript, callbackNumber: string): string {
  const digits = callbackNumber.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const spaced = (part: string) => part.split('').join(' ');
  const spoken =
    national.length === 10
      ? [national.slice(0, 3), national.slice(3, 6), national.slice(6)].map(spaced).join(', ')
      : spaced(national);
  return script.voicemailBody.split('{callback_number}').join(spoken);
}
