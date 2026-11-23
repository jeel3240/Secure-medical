/**
 * One call's conversation with Seri - A11 and A12, docs/AI-AGENT.md sections
 * 1-3 and 6.
 *
 * The relay (relay.ts) hands this what the lead says and does; this asks
 * the brain (brain.ts - understand, decide, speak), and sends Twilio what she
 * says, a sentence at a time:
 *
 *   the lead speaks    the stop check first - the script's stop words, or key
 *                      9, end the call as an opt-out whatever she would say;
 *                      then who is there now, and the brain with the whole call
 *   each sentence      checked (safety.ts) and sent the moment it is whole; a
 *                      replaced one is the last of that reply; after her
 *                      first question, the rest waits for the reply's end -
 *                      never said if her action waits for the lead's answer
 *   an action          checked again (`toHandoff`); taken: her last line,
 *                      then `end` straight after it (A02 - Twilio says the
 *                      whole line first); refused - the brain was wrong
 *                      (`ai_policy.guard`): she speaks again at once without
 *                      it - or, when her reply asked something, waits for the
 *                      lead's answer
 *   talked over        the reply stops, and the call's history keeps only
 *                      what the lead heard of it
 *
 * The history is what the brain is given: the greeting Twilio said, then each
 * turn - the lead's with a note of who is there (`leadMessage`), hers as the
 * lead heard them. Until 2026-11-19 it was sent to OpenAI whole, with today's
 * brain's instructions and notes after the lead's turns; the new brain reads
 * it instead, and those were removed (docs/AI-AGENT.md section 12).
 *
 * The limits (A12), counted from `start()` on `timers` - a fake clock in tests:
 *
 *   silence            the lead says nothing for 6 seconds after Twilio says
 *                      she stopped talking (`agentSpeaking` off): "Hello, are
 *                      you still there?"; silent again, a goodbye and
 *                      `end_call` (`no_response`)
 *   3 minutes          a note for the brain, with her next reply, to wrap up; 20
 *                      seconds on, the call ends (`time_limit`) - after the
 *                      reply she is saying, if she has started one, given
 *                      10 seconds more at most
 *   OpenAI slow        no first word from the brain in 4 seconds: "One moment..."; none 4
 *                      seconds later: `fallback` - the script takes the call (A14)
 *   OpenAI failing     `fallback`; so does the socket or the relay failing (`fail`)
 *
 * Voicemail (A18): an action that ends the call - a goodbye, the link, a call
 * back - waits for Twilio's verdict on who answered, up to 15 seconds after
 * her last line, so a greeting she took for a "no" still gets the voicemail
 * message when its beep comes (`onVerdict`, T18). A transfer and a stop do
 * not wait.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { CallHours } from '../core/auto-dial';
import { saysStop } from '../core/answers';
import { errText, log } from '../lib/log';
import { fallbackHandoff, handoffData, lastLine, lineToAdd, toHandoff, waitsForAnswer, type Handoff } from './actions';
import { whoIsThereNote, type WhoIsThere } from './instructions';
import type { ModelToolCall, SeriModel } from './openai';
import { endMessage, refusedNote, replacedNote, stopNote, textMessage, unsaidNote } from './relay-messages';
import type { Turn } from './relay-store';
import type { Earlier } from './resume';
import { checkSentence, specialistLine } from './safety';
import { asks, SentenceSplitter } from './sentences';
import { greetingWithTone, spokenWords, withTone } from './tone';

/** The lead's turn as the brain gets it: who is there now, then what they said. */
export function leadMessage(who: WhoIsThere, said: string): ChatCompletionMessageParam {
  return { role: 'user', content: `${whoIsThereNote(who)} ${said}` };
}

/** The stop key, as on the script (T13). */
export const STOP_KEY = '9';

/**
 * How many actions in a row may be refused before she waits for the lead: after
 * the first, the brain decides again without it, and she speaks at once.
 */
const MAX_ACTION_TRIES = 2;
/** Talked over with nothing heard, this long after her first sentence was sent: that sentence was (`heardAnyway`). */
export const HEARD_ANYWAY_MS = 2_000;

/** The limits - section 6, decided by Jeel, 2026-11-11. */
export const LIMITS = {
  /** The lead silent this long after she stopped talking. */
  silenceMs: 6_000,
  /**
   * Twilio saying the lead is talking, with no words after it, holds the
   * silence at most this long - then it counts on (A25, call 112).
   */
  noWordsMs: 4_000,
  /** How long the call goes on before she is told to wrap up. */
  callMs: 3 * 60_000,
  /** How long she then has, before the relay ends the call. */
  wrapUpMs: 20_000,
  /** A reply she has started by then has this long to be written whole. */
  lastReplyMs: 10_000,
  /** No first word from OpenAI in this long: the filler. */
  firstWordMs: 4_000,
  /** Still none this long after the filler: the fallback. */
  afterFillerMs: 4_000,
} as const;

/** Said after the first silence. */
export const STILL_THERE_LINE = 'Hello, are you still there?';

/** Said while OpenAI is slow. Not in the history: she would start saying it herself. */
export const FILLER_LINE = 'One moment...';
/**
 * A marker after her reply in the call's history: a sentence of it was replaced
 * by the specialist line (the safety check). Never said, never sent to OpenAI;
 * the brain reads it (review M2).
 */
export const REPLACED_NOTE = 'A sentence of her reply was replaced with the specialist line.';

/**
 * How long an action that ends the call waits, after her last line, for
 * Twilio's verdict on who answered - A18. On the real calls to a person Twilio
 * decided 3.4 to 6.6 seconds in (AUTO-CALLS.md, "Voicemail"), so a person
 * seldom waits, and then only moments after her goodbye; a call Twilio has not
 * decided by then is most likely a machine still greeting, whose beep comes
 * when the greeting ends - 9 seconds in on T18's real voicemail.
 */
export const VERDICT_WAIT_MS = 15_000;
/** How often the wait asks whether the verdict has come. */
export const VERDICT_POLL_MS = 500;

/** Twilio's verdict as the relay waits on it: not yet, come - or come and the voicemail message took the call. */
export type VerdictState = 'pending' | 'in' | 'taken';

/** Kept when the voicemail message took the call while her ending action waited. */
export const VOICEMAIL_TOOK_NOTE = 'Not done: a machine answered, and the voicemail message took the call.';

/** The actions that wait for the verdict: those that end the call. A transfer and a stop do not. */
const WAITS_FOR_VERDICT: ReadonlySet<Handoff['action']> = new Set(['end_call', 'send_link', 'book_callback'] as const);

/**
 * Put in the history with her first reply after three minutes: the brain reads
 * it and wraps up (`wrapUpDue`, policy.ts). Never said, never sent to OpenAI.
 */
export const WRAP_UP_NOTE = 'The call has gone on for three minutes: wrap up.';

/** Where the limits are counted: the real clock, or a fake one in tests. */
export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  /** Milliseconds on this clock - for how much of a wait is left. */
  now(): number;
}

export const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface ConversationSetup {
  callId: number;
  /** What Twilio said when the lead picked up - `welcomeGreeting`. */
  greeting: string;
  hours: CallHours;
  /** The script's stop line, and its stop words. */
  stopLine: string;
  optOutWords: readonly string[];
  /** False when the lead's area code does not tell their zone: a call back's time is then said as Arizona time (review H11). */
  zoneKnown?: boolean;
  /**
   * A call picked back up after the line dropped (resume.ts): the
   * conversation so far, what the lead said that she never answered, and when
   * she took the call. Absent on a call she has just taken.
   */
  earlier?: Earlier;
}

export interface ConversationDeps {
  /** The brain (brain.ts): her reply to the call so far. */
  model: SeriModel;
  /** Who could take the call now - asked before each reply. */
  whoIsThere: () => Promise<WhoIsThere>;
  /** Keeps a turn. The relay keeps them in order; nothing waits for it. */
  keep: (turn: Omit<Turn, 'callId'>) => void;
  /** Records how her part ended. Nothing waits for it. */
  ended: (handoff: Handoff) => void;
  /** A message to Twilio. */
  send: (message: string) => void;
  /** Twilio's verdict on who answered (A18). Absent: nothing waits for it. */
  verdict?: () => Promise<VerdictState>;
  now?: () => Date;
  timers?: Timers;
}

/** One reply of Seri's, from the lead's words to her last sentence. */
interface Reply {
  abort: AbortController;
  /** When the lead's words arrived. */
  heardAt: number;
  who: WhoIsThere;
  /** The sentences sent to Twilio, in order. */
  sent: string[];
  /** When OpenAI's first word - or action - arrived. */
  firstWordAt: number | null;
  firstSentAt: number | null;
  /** The same, on the call's clock - how long Twilio has been saying it when the lead talks over her. */
  firstSpokenAt: number | null;
  /** Notes kept after her turn: a sentence replaced, an action refused. */
  notes: Omit<Turn, 'callId'>[];
  replaced: boolean;
  action: string | null;
  done: boolean;
  /** The wait for OpenAI's first word (A12). */
  timer: unknown;
  /** "One moment..." was said: OpenAI was slow. */
  filler: boolean;
  /** Sentences written after her question and never said: her action waits for the answer. */
  unsaid: number;
  /** Her brain chose to say nothing (review R9): not an empty reply. */
  quiet: boolean;
}

export class Conversation {
  private readonly history: ChatCompletionMessageParam[];
  /** What the lead has said that is not yet in the history: it goes in with the next reply's note of who is there. */
  private pending: string[] = [];
  private reply: Reply | null = null;
  private over = false;
  private readonly now: () => Date;
  private readonly timers: Timers;
  /** Her last reply heard whole, while it is the last she said - review M1. */
  private lastReply: { index: number; firstSpokenAt: number | null; first: string } | null = null;
  /** The limits are counting. */
  private started = false;
  /** Twilio's speaker events (`events="speaker-events"`, A13): the silence counts only while nobody talks. */
  private agentSpeaking = false;
  private leadSpeaking = false;
  private silenceTimer: unknown = null;
  /** When the silence will be up, on `timers`' clock, while it counts. */
  private silenceDue = 0;
  /** What is left of the silence: held while the lead "talks" with no words, then counted on (A25). */
  private silenceLeft: number = LIMITS.silenceMs;
  /** How long this silence was held by the lead "talking" with no words - for the log. */
  private silenceHeldMs = 0;
  private heldSince: number | null = null;
  /** The lead has "talked" with no words for `noWordsMs`: the silence counts on. */
  private noWordsTimer: unknown = null;
  /** "Are you still there?" was said, and nothing has come from the lead since. */
  private askedStillThere = false;
  private callTimer: unknown = null;
  private wrapUpTimer: unknown = null;
  /** The three minutes are up: the note goes with her next reply, once. */
  private wrapUp: 'not_yet' | 'due' | 'given' = 'not_yet';
  /** The 20 seconds ran out while she was saying a reply: the call ends once it is over. */
  private endOnceSaid = false;
  /** The WebSocket closed: whatever was waiting does nothing more. */
  private closed = false;
  /** The wait for Twilio's verdict before an ending action (A18). */
  private verdictTimer: unknown = null;
  /** `end` was reached: her action, or a fallback. */
  private endedPart = false;

  constructor(
    private readonly setup: ConversationSetup,
    private readonly deps: ConversationDeps
  ) {
    this.history = [
      // As the voice was sent it, warmly.
      { role: 'assistant', content: greetingWithTone(setup.greeting) },
      ...(setup.earlier?.messages ?? []),
    ];
    this.pending = [...(setup.earlier?.pending ?? [])];
    this.now = deps.now ?? (() => new Date());
    this.timers = deps.timers ?? realTimers;
  }

  /** The session has been ended: nothing more is said. */
  get isOver(): boolean {
    return this.over;
  }

  /** Her part ended - her action, or a fallback - rather than the socket closing first. */
  get ended(): boolean {
    return this.endedPart;
  }

  /** What the brain would be given now - for tests. */
  get messages(): readonly ChatCompletionMessageParam[] {
    return this.history;
  }

  /**
   * Twilio is saying her greeting: the limits start counting (A12). Or, on a
   * call picked back up (`earlier`), the call goes on: the three minutes count
   * from when she took it, and what the lead said that she never answered is
   * answered now.
   */
  start(): void {
    if (this.started || this.over) return;
    this.started = true;
    const earlier = this.setup.earlier;
    const leftMs = earlier ? LIMITS.callMs - (this.now().getTime() - earlier.startedAt.getTime()) : LIMITS.callMs;
    if (leftMs > 0) this.callTimer = this.timers.set(() => this.callTimeUp(), leftMs);
    else this.callTimeUp();
    if (this.pending.length > 0) {
      void this.respond({ heardAt: Date.now(), attempt: 0 });
      return;
    }
    this.watchSilence();
  }

  /**
   * Twilio's speaker events: who is talking now. Her talking stops the
   * silence, and it counts afresh when she stops. The lead "talking" only
   * holds it: words that follow are `heard`; with none - a noise, an "mm"
   * Twilio drops - the silence counts on from where it was, and after
   * `noWordsMs` of "talking" with no words, counts on all the same. Call 112:
   * "are you still there?" came 13 seconds after her question, not 6.
   */
  speaking(who: 'agent' | 'client', on: boolean): void {
    if (this.over) return;
    if (who === 'agent') {
      this.agentSpeaking = on;
      if (on) this.stopSilence();
      else this.watchSilence();
      return;
    }
    this.leadSpeaking = on;
    this.stopNoWords();
    if (on) {
      this.holdSilence();
      this.noWordsTimer = this.timers.set(() => {
        this.noWordsTimer = null;
        this.leadSpeaking = false;
        this.countSilence();
      }, LIMITS.noWordsMs);
    } else {
      this.countSilence();
    }
  }

  /**
   * The lead's words while they are still speaking (A33, `partialPrompts`):
   * handed to the model for a head start, and nothing else - not a turn, not
   * kept, no effect on silence or on her talking.
   */
  partial(said: string): void {
    if (this.over || !this.deps.model.prefetch) return;
    this.deps.model.prefetch([...this.history], said);
  }

  /** The lead finished saying something. */
  heard(said: string): void {
    if (this.over) return;
    const heardAt = Date.now();
    this.askedStillThere = false;
    this.stopNoWords();
    this.stopSilence();
    if (saysStop(said, this.setup.optOutWords)) {
      this.optOut('words');
      return;
    }
    this.pending.push(said);
    // Something she was still writing is dropped: the lead has said more.
    if (this.reply) this.finish(this.reply, { cut: true });
    void this.respond({ heardAt, attempt: 0 });
  }

  /** The lead pressed a key. Only the stop key means anything to her; any key says they are there. */
  pressed(digit: string): void {
    if (this.over) return;
    this.askedStillThere = false;
    if (digit === STOP_KEY) {
      this.optOut('key');
      return;
    }
    this.watchSilence();
  }

  /** The lead spoke over her: `heard` is what she had said by then. */
  interrupted(heard: string): void {
    if (this.over) return;
    if (this.reply) this.finish(this.reply, { heard: heard || this.heardAnyway(this.reply) });
    // Her reply was all written - Twilio was still saying it.
    else if (heard) this.replaceLastSaid(heard);
    // And Twilio says nothing was heard: the same rule as while she writes - her first sentence, two seconds or more
    // after it went; sooner, none of it, so none of it is taken as said. It counted all of it, offers and questions
    // too (review M1, 2026-11-22).
    else this.nothingHeardOfLast();
    this.afterReply();
  }

  /** `interrupted` with nothing heard of a reply all written: her first sentence, or none of it (review M1). */
  private nothingHeardOfLast(): void {
    const last = this.lastReply;
    // Only the reply it was about: anything said since - "are you still there?" - is not it.
    if (!last || this.history.length - 1 < last.index || this.history[last.index]?.role !== 'assistant') return;
    if (this.history.slice(last.index + 1).some((m) => m.role === 'assistant')) return;
    const sinceMs = last.firstSpokenAt === null ? 0 : this.timers.now() - last.firstSpokenAt;
    if (sinceMs >= HEARD_ANYWAY_MS && last.first) {
      log.info('ai_relay.heard_anyway', { callId: this.setup.callId, sinceMs });
      this.history[last.index] = { role: 'assistant', content: /^.*?[.!?](?=\s|$)/.exec(last.first)?.[0] ?? last.first };
    } else {
      this.history.splice(last.index, 1);
    }
    this.lastReply = null;
  }

  /**
   * Twilio sometimes says nothing was heard when she had been speaking for
   * seconds (calls 136, 137 - an empty "heard"): taken at its word, what she
   * said counted as never said, and she said it all again. With her first
   * sentence sent `HEARD_ANYWAY_MS` or more before, that sentence was heard.
   */
  private heardAnyway(reply: Reply): string {
    if (reply.firstSpokenAt === null || reply.sent.length === 0) return '';
    const sinceMs = this.timers.now() - reply.firstSpokenAt;
    if (sinceMs < HEARD_ANYWAY_MS) return '';
    const first = spokenWords(reply.sent[0]);
    log.info('ai_relay.heard_anyway', { callId: this.setup.callId, sinceMs });
    return /^.*?[.!?](?=\s|$)/.exec(first)?.[0] ?? first;
  }

  /**
   * Seri cannot go on - OpenAI, the socket or the relay failed: whatever she
   * was saying is closed, and the session ends with `fallback`, so the script
   * takes the call (A14).
   */
  fail(why: string): void {
    if (this.over) return;
    if (this.reply) this.finish(this.reply);
    this.end(fallbackHandoff(why));
  }

  /** The WebSocket closed. */
  close(): void {
    this.over = true;
    this.closed = true;
    this.timers.clear(this.verdictTimer);
    this.stopClocks();
    // What she had said of a reply still going is kept: the lead hanging up mid-sentence lost it from the record
    // (review M6, 2026-11-22). Nothing is sent - the line is gone.
    if (this.reply) this.finish(this.reply, { closed: true });
    if (this.reply) {
      this.timers.clear(this.reply.timer);
      this.reply.abort.abort();
    }
  }

  /**
   * Her reply the lead has just answered - the greeting before her first. Not
   * an action of hers refused since: the lead never answered that.
   */
  private answeredReply(): string {
    let i = this.history.length - 1;
    while (i >= 0 && this.history[i].role !== 'user') i--;
    for (i--; i >= 0; i--) {
      const message = this.history[i];
      if (message.role === 'assistant' && typeof message.content === 'string' && message.content) return message.content;
    }
    return '';
  }

  private replaceLastSaid(heard: string): void {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const message = this.history[i];
      if (message.role === 'assistant') {
        this.history[i] = { ...message, content: heard };
        return;
      }
    }
  }

  private async respond(opts: { heardAt: number; attempt: number; who?: WhoIsThere }): Promise<void> {
    if (this.endOnceSaid) {
      this.endBy({ action: 'end_call', reason: 'time_limit' });
      return;
    }
    this.stopSilence();
    const reply: Reply = {
      abort: new AbortController(),
      heardAt: opts.heardAt,
      who: opts.who ?? 'nobody',
      sent: [],
      firstWordAt: null,
      firstSentAt: null,
      firstSpokenAt: null,
      notes: [],
      replaced: false,
      action: null,
      done: false,
      timer: null,
      filler: false,
      unsaid: 0,
      quiet: false,
    };
    this.reply = reply;
    reply.timer = this.timers.set(() => this.slow(reply), LIMITS.firstWordMs);

    if (!opts.who) {
      try {
        reply.who = await this.deps.whoIsThere();
      } catch (err) {
        // Nobody, so she never promises a transfer that cannot happen.
        log.error('ai_relay.who_failed', { callId: this.setup.callId, err: errText(err) });
      }
      if (reply.done || this.over) return;
      this.history.push(leadMessage(reply.who, this.pending.join(' ')));
      this.pending = [];
    }
    if (this.wrapUp === 'due') {
      this.wrapUp = 'given';
      this.history.push({ role: 'system', content: WRAP_UP_NOTE });
      log.info('ai_relay.wrap_up', { callId: this.setup.callId });
    }

    const splitter = new SentenceSplitter();
    // After her first question, the rest of her reply waits for its end: if
    // she ends it with an action that waits for the lead's answer, it is never
    // said - she asked, and the lead answers (A21's call 95: "So that's
    // Tuesday at 12 PM your time? Great, I'll schedule that call back now.
    // Goodbye." and the booking, held back for the answer). Otherwise it is
    // said then, while the question is still being spoken.
    let asked = false;
    const held: string[] = [];
    const say = (sentence: string): boolean => {
      if (asked) {
        held.push(sentence);
        return true;
      }
      if (asks(spokenWords(sentence))) asked = true;
      return this.speak(reply, sentence);
    };
    let tool: ModelToolCall | null = null;
    try {
      for await (const event of this.deps.model.reply([...this.history], reply.abort.signal)) {
        // The call closed - a hang-up, the beep - is over for her reply too: nothing more said or carried out (review H5).
        if (reply.done || this.over) return;
        if (event.type === 'quiet') {
          reply.quiet = true;
          continue;
        }
        if (reply.firstWordAt === null) {
          reply.firstWordAt = Date.now();
          this.timers.clear(reply.timer);
        }
        if (event.type === 'tool') {
          tool ??= event.call;
          continue;
        }
        for (const sentence of splitter.push(event.text)) {
          if (!say(sentence)) break;
        }
        if (reply.replaced) break;
      }
      if (reply.done || this.over) return;
      if (!reply.replaced) {
        for (const sentence of splitter.flush()) {
          if (!say(sentence)) break;
        }
      }
    } catch (err) {
      // Stopped on purpose: talked over, the lead said more, too slow - or the call closed: a voicemail's beep took it,
      // the lead hung up (A34's call 117 logged that as OpenAI failing).
      if (reply.done || this.over) return;
      log.error('ai_relay.model_failed', { callId: this.setup.callId, err: errText(err) });
      this.fail('model_failed');
      return;
    }
    if (reply.done || this.over) return;

    if (held.length > 0 && !reply.replaced) {
      if (tool && waitsForAnswer(tool.name)) {
        reply.unsaid = held.length;
        reply.notes.push({ who: 'system', text: unsaidNote(held.join(' ')) });
      } else {
        for (const sentence of held) if (!this.speak(reply, sentence)) break;
      }
    }

    // A replaced sentence asked whether they want a specialist: the action
    // waits for the answer.
    if (tool && !reply.replaced) {
      this.act(reply, tool, opts.attempt);
      return;
    }
    if (reply.sent.length === 0 && !reply.quiet) log.warn('ai_relay.empty_reply', { callId: this.setup.callId });
    this.finish(reply);
    this.afterReply();
  }

  /** OpenAI has not started her reply: the filler at 4 seconds, the script at 8 (section 6). */
  private slow(reply: Reply): void {
    if (reply.done || this.over || reply.firstWordAt !== null) return;
    const waitedMs = Date.now() - reply.heardAt;
    if (!reply.filler) {
      reply.filler = true;
      // Opens her utterance: what she says next follows it, and `finish` closes it.
      this.deps.send(textMessage(`${FILLER_LINE} `, false));
      this.deps.keep({ who: 'seri', text: FILLER_LINE, latencyMs: waitedMs });
      log.warn('ai_relay.filler', { callId: this.setup.callId, waitedMs });
      reply.timer = this.timers.set(() => this.slow(reply), LIMITS.afterFillerMs);
      return;
    }
    log.error('ai_relay.model_slow', { callId: this.setup.callId, waitedMs });
    this.fail('model_slow');
  }

  /**
   * Checks one sentence and sends it - or the specialist line in its place,
   * ending the reply. Her words are checked; the voice is sent them with her
   * tone (tone.ts). A tone with no words is nothing to say.
   */
  private speak(reply: Reply, sentence: string): boolean {
    const words = spokenWords(sentence);
    if (!words) return true;
    const check = checkSentence(words);
    const said = check.reason ? specialistLine(reply.who) : withTone(sentence);
    this.deps.send(textMessage(`${said} `, false));
    reply.sent.push(said);
    reply.firstSentAt ??= Date.now();
    reply.firstSpokenAt ??= this.timers.now();
    if (!check.reason) return true;
    reply.replaced = true;
    reply.notes.push({ who: 'system', text: replacedNote(check.reason, check.found, words) });
    reply.abort.abort();
    return false;
  }

  private act(reply: Reply, tool: ModelToolCall, attempt: number): void {
    // With her tone, for OpenAI's history; her words alone, for the checks.
    const said = reply.sent.join(' ');
    const words = spokenWords(said);
    const now = this.now();
    reply.action = tool.name;
    const result = toHandoff(
      { name: tool.name, arguments: tool.arguments },
      { whoIsThere: reply.who, hours: this.setup.hours, now, said: words, before: spokenWords(this.answeredReply()) }
    );

    if (result.ok) {
      const line = lineToAdd(result.handoff, words, { stopLine: this.setup.stopLine, now, zoneKnown: this.setup.zoneKnown });
      if (line) {
        this.deps.send(textMessage(`${line} `, false));
        reply.sent.push(line);
        reply.firstSentAt ??= Date.now();
        reply.firstSpokenAt ??= this.timers.now();
      }
      this.finish(reply);
      this.end(result.handoff);
      return;
    }

    // Refused: kept in the history, so the brain decides again without it (`ai_policy.guard`).
    const id = tool.id || `call_${this.history.length}`;
    this.history.push(
      { role: 'assistant', content: said || null, tool_calls: [{ id, type: 'function', function: { name: tool.name, arguments: tool.arguments } }] },
      { role: 'tool', tool_call_id: id, content: result.error }
    );
    reply.notes.push({ who: 'system', text: refusedNote(tool.name, result.error) });
    this.finish(reply, { inHistory: true });
    if (result.awaitLead || attempt + 1 >= MAX_ACTION_TRIES) {
      this.afterReply();
      return;
    }
    void this.respond({ heardAt: reply.heardAt, attempt: attempt + 1, who: reply.who });
  }

  /**
   * Ends a reply, once: closes it on Twilio, keeps her turn and its notes, and
   * puts what the lead heard into the history.
   * - `heard`: talked over - only what Twilio had said, and nothing more sent;
   * - `cut`: the lead said more before she finished - what was sent stands;
   * - `inHistory`: already there, with the action that was refused.
   */
  private finish(reply: Reply, how: { heard?: string; cut?: true; inHistory?: true; closed?: true } = {}): void {
    if (reply.done) return;
    reply.done = true;
    this.timers.clear(reply.timer);
    reply.abort.abort();
    if (this.reply === reply) this.reply = null;

    // With her tone: what she said, and the brain reads back in its history. Kept on
    // record as her words alone - the tone is how they were said (tone.ts).
    const said = reply.sent.join(' ');
    // The filler opened her utterance too: it is closed whatever came after it - unless the line is gone.
    if ((said || reply.filler) && how.heard === undefined && !how.closed) this.deps.send(textMessage('', true));
    if (said) {
      this.deps.keep({ who: 'seri', text: spokenWords(said), latencyMs: Math.max(0, (reply.firstSentAt ?? Date.now()) - reply.heardAt) });
      if (!how.inHistory) {
        const heard = how.heard === undefined ? said : how.heard;
        if (heard) {
          this.history.push({ role: 'assistant', content: heard });
          // A reply the lead heard all of - not talked over - for M1 below: when it began, and its first sentence.
          this.lastReply = { index: this.history.length - 1, firstSpokenAt: reply.firstSpokenAt, first: spokenWords(reply.sent[0] ?? '') };
          // A sentence of it the safety check replaced with the specialist line: the brain records that line, and
          // its question, not the moves it decided (review M2, 2026-11-22).
          if (reply.replaced) this.history.push({ role: 'system', content: REPLACED_NOTE });
        }
      }
    }
    for (const note of reply.notes) this.deps.keep(note);

    log.info('ai_relay.reply', {
      callId: this.setup.callId,
      who: reply.who,
      latencyMs: reply.firstSentAt === null ? null : reply.firstSentAt - reply.heardAt,
      // How much of that was OpenAI: the rest is the first sentence being written whole.
      firstWordMs: reply.firstWordAt === null ? null : reply.firstWordAt - reply.heardAt,
      sentences: reply.sent.length,
      replaced: reply.replaced,
      action: reply.action,
      stopped: how.heard !== undefined ? 'talked_over' : how.cut ? 'lead_said_more' : how.closed ? 'call_closed' : null,
      filler: reply.filler,
      unsaid: reply.unsaid,
    });
  }

  /** Her reply is over and it is the lead's turn: the silence counts - or, past the time limit, the call ends. */
  private afterReply(): void {
    if (this.over || this.reply) return;
    if (this.endOnceSaid) {
      this.endBy({ action: 'end_call', reason: 'time_limit' });
      return;
    }
    this.watchSilence();
  }

  /** Counts the silence afresh from now, while nobody is talking and she is not answering. */
  private watchSilence(): void {
    this.stopSilence();
    this.silenceLeft = LIMITS.silenceMs;
    this.silenceHeldMs = 0;
    this.heldSince = null;
    this.countSilence();
  }

  /** Counts on what is left of the silence - nothing while someone talks or she answers. */
  private countSilence(): void {
    if (this.heldSince !== null) {
      this.silenceHeldMs += this.timers.now() - this.heldSince;
      this.heldSince = null;
    }
    if (this.silenceTimer !== null) this.timers.clear(this.silenceTimer);
    this.silenceTimer = null;
    if (!this.started || this.over || this.reply || this.agentSpeaking || this.leadSpeaking) return;
    this.silenceDue = this.timers.now() + this.silenceLeft;
    this.silenceTimer = this.timers.set(() => this.silent(), this.silenceLeft);
  }

  /** Holds the silence where it is: the lead may be talking. */
  private holdSilence(): void {
    if (this.silenceTimer === null) return;
    this.timers.clear(this.silenceTimer);
    this.silenceTimer = null;
    this.silenceLeft = Math.max(0, this.silenceDue - this.timers.now());
    this.heldSince = this.timers.now();
  }

  private stopSilence(): void {
    if (this.silenceTimer !== null) this.timers.clear(this.silenceTimer);
    this.silenceTimer = null;
  }

  private stopNoWords(): void {
    if (this.noWordsTimer !== null) this.timers.clear(this.noWordsTimer);
    this.noWordsTimer = null;
  }

  private silent(): void {
    this.silenceTimer = null;
    if (this.over || this.reply) return;
    if (this.askedStillThere) {
      this.endBy({ action: 'end_call', reason: 'no_response' });
      return;
    }
    this.askedStillThere = true;
    this.say(STILL_THERE_LINE);
    this.history.push({ role: 'assistant', content: STILL_THERE_LINE });
    log.info('ai_relay.still_there', { callId: this.setup.callId, heldMs: this.silenceHeldMs });
    // Counted again from now - and from the end of the line, once Twilio says it was said.
    this.watchSilence();
  }

  private callTimeUp(): void {
    if (this.over) return;
    this.wrapUp = 'due';
    this.wrapUpTimer = this.timers.set(() => this.wrapUpOver(), LIMITS.wrapUpMs);
  }

  private wrapUpOver(): void {
    if (this.over) return;
    // A reply she has started saying may be her wrap-up, with its action: it is
    // let finish - within a limit, for a reply OpenAI never finishes.
    if (this.reply && this.reply.firstWordAt !== null) {
      this.endOnceSaid = true;
      this.wrapUpTimer = this.timers.set(() => this.endBy({ action: 'end_call', reason: 'time_limit' }), LIMITS.lastReplyMs);
      return;
    }
    this.endBy({ action: 'end_call', reason: 'time_limit' });
  }

  /** The relay ends the call itself - silence, the time limit: the action's own last line, then the end. */
  private endBy(handoff: Handoff): void {
    if (this.over) return;
    if (this.reply) this.finish(this.reply, { cut: true });
    const line = lastLine(handoff, { stopLine: this.setup.stopLine, now: this.now(), zoneKnown: this.setup.zoneKnown });
    if (line) this.say(line);
    this.end(handoff);
  }

  /** A line of the relay's own, said on its own in her voice, and kept as hers. */
  private say(line: string, latencyMs: number | null = null): void {
    this.deps.send(textMessage(line, true));
    this.deps.keep({ who: 'seri', text: line, latencyMs });
  }

  /** The lead asked to stop: the script's stop line, then the opt-out - whatever she was saying. */
  private optOut(via: 'words' | 'key'): void {
    if (this.reply) this.finish(this.reply, { cut: true });
    this.deps.keep({ who: 'system', text: stopNote(via) });
    this.say(this.setup.stopLine, 0);
    this.end({ action: 'opt_out' });
  }

  private end(handoff: Handoff): void {
    this.over = true;
    this.endedPart = true;
    this.stopClocks();
    // Her choice is kept at once, waiting or not: a lead who hangs up in the
    // wait still gets what needs no line - the action URL reads it (A14).
    this.deps.keep({ who: 'action', text: handoffData(handoff) });
    if (WAITS_FOR_VERDICT.has(handoff.action) && this.deps.verdict) {
      this.awaitVerdict(handoff, 0);
      return;
    }
    this.endNow(handoff);
  }

  /**
   * An action that ends the call, held until Twilio's verdict has come (A18):
   * then it ends as chosen; after `VERDICT_WAIT_MS` it ends all the same. The
   * voicemail message took the call meanwhile - the greeting's beep - and it
   * ends nothing: the call is the message's, her part is left unrecorded, and
   * a note says why her choice was not carried out. The socket closing
   * meanwhile - the lead hung up - leaves it to the action URL. Unable to read
   * the verdict, it does not hold the call.
   */
  private awaitVerdict(handoff: Handoff, waitedMs: number): void {
    if (this.closed) return;
    this.deps.verdict!().then(
      (state) => this.afterVerdict(handoff, waitedMs, state),
      () => this.afterVerdict(handoff, waitedMs, 'in')
    );
  }

  private afterVerdict(handoff: Handoff, waitedMs: number, state: VerdictState): void {
    if (this.closed) return;
    if (state === 'pending' && waitedMs < VERDICT_WAIT_MS) {
      this.verdictTimer = this.timers.set(() => this.awaitVerdict(handoff, waitedMs + VERDICT_POLL_MS), VERDICT_POLL_MS);
      return;
    }
    if (waitedMs > 0 || state === 'taken') {
      log.info('ai_relay.verdict_wait', {
        callId: this.setup.callId,
        action: handoff.action,
        waitedMs,
        verdict: state === 'pending' ? 'none' : state,
      });
    }
    if (state === 'taken') {
      this.deps.keep({ who: 'system', text: VOICEMAIL_TOOK_NOTE });
      return;
    }
    this.endNow(handoff);
  }

  /** Her part over: recorded, and Twilio told - straight after her last line (A02). Her choice is already kept (`end`). */
  private endNow(handoff: Handoff): void {
    this.deps.ended(handoff);
    this.deps.send(endMessage(handoff));
    const reason = handoff.action === 'end_call' ? handoff.reason : handoff.action === 'fallback' ? handoff.why : undefined;
    log.info('ai_relay.ended', { callId: this.setup.callId, action: handoff.action, ...(reason ? { reason } : {}) });
  }

  private stopClocks(): void {
    this.stopSilence();
    this.stopNoWords();
    this.timers.clear(this.callTimer);
    this.timers.clear(this.wrapUpTimer);
    this.callTimer = null;
    this.wrapUpTimer = null;
  }
}
