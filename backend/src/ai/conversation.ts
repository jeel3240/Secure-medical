/**
 * One call's conversation with Seri - A11 and A12, docs/AI-AGENT.md sections
 * 1-3 and 6.
 *
 * The relay (relay.ts) hands this what the lead says and does; this asks
 * OpenAI, and sends Twilio what she says, a sentence at a time:
 *
 *   the lead speaks    the stop check first - the script's stop words, or key
 *                      9, end the call as an opt-out whatever she would say;
 *                      then who is there now, and OpenAI with the whole call
 *   each sentence      checked (safety.ts) and sent the moment it is whole; a
 *                      replaced one is the last of that reply
 *   an action          checked (`toHandoff`); taken: her last line, then
 *                      `end` straight after it (A02 - Twilio says the whole
 *                      line first); refused: she is told why, and speaks
 *                      again at once - or, when her reply asked something,
 *                      waits for the lead's answer
 *   talked over        the reply stops, and the call's history keeps only
 *                      what the lead heard of it
 *
 * The history is what OpenAI is sent: the instructions, the greeting Twilio
 * said, then each turn - built as the answer test set builds it (`leadTurn`,
 * evals/grade.ts), so what is tested is what calls use.
 *
 * The limits (A12), counted from `start()` on `timers` - a fake clock in tests:
 *
 *   silence            the lead says nothing for 6 seconds after Twilio says
 *                      she stopped talking (`agentSpeaking` off): "Hello, are
 *                      you still there?"; silent again, a goodbye and
 *                      `end_call` (`no_response`)
 *   3 minutes          a note to her, with her next reply, to wrap up; 20
 *                      seconds on, the call ends (`time_limit`) - after the
 *                      reply she is saying, if she has started one, given
 *                      10 seconds more at most
 *   OpenAI slow        no first word in 4 seconds: "One moment..."; none 4
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
import { fallbackHandoff, handoffData, lastLine, lineToAdd, toHandoff, writtenAction, type Handoff } from './actions';
import { whoIsThereNote, type WhoIsThere } from './instructions';
import type { ModelToolCall, SeriModel } from './openai';
import { endMessage, refusedNote, replacedNote, stopNote, textMessage } from './relay-messages';
import type { Turn } from './relay-store';
import { checkSentence } from './safety';
import { SentenceSplitter } from './sentences';
import { greetingWithTone, spokenWords, withTone } from './tone';

/** The lead's turn as OpenAI gets it: who is there now, then what they said. */
export function leadMessage(who: WhoIsThere, said: string): ChatCompletionMessageParam {
  return { role: 'user', content: `${whoIsThereNote(who)} ${said}` };
}

/** The stop key, as on the script (T13). */
export const STOP_KEY = '9';

/**
 * How many actions in a row may be refused before she waits for the lead: the
 * first refusal tells her what to do instead, and she speaks again at once.
 */
const MAX_ACTION_TRIES = 2;

/** The limits - section 6, decided by Jeel, 2026-11-11. */
export const LIMITS = {
  /** The lead silent this long after she stopped talking. */
  silenceMs: 6_000,
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
 * Her reply offered to put the lead through - "connect you", "talk to
 * someone". Found on A21's real call 90: seven of her nine replies ended so,
 * and the lead asked why she kept saying it.
 */
const OFFERED_TO_CONNECT = /\b(connect(ing)? you|transfer you|(talk|speak) (to|with) (someone|somebody|a (person|representative|specialist|real person)|one of our))\b/i;

export function offeredToConnect(said: string): boolean {
  return OFFERED_TO_CONNECT.test(said);
}

/**
 * Given to her with the lead's next turn after a reply that offered to
 * connect them: her instructions say not to offer twice in a row, and she did
 * all the same - a note at the moment is what she follows (A21).
 */
export const NO_REPEAT_NOTE =
  "Your last reply already offered to connect them with someone. If they said yes, go ahead. If not, don't offer it again in this reply: answer them, then ask if there's anything else they'd like to know.";

/** The lead's turn, and the note against offering twice in a row when her last reply offered (`NO_REPEAT_NOTE`). */
export function leadTurn(who: WhoIsThere, said: string, herLastReply: string): ChatCompletionMessageParam[] {
  const turn = leadMessage(who, said);
  return offeredToConnect(herLastReply) ? [turn, { role: 'system', content: NO_REPEAT_NOTE }] : [turn];
}

/** Given to her with her first reply after three minutes. */
export const WRAP_UP_NOTE =
  'The call has gone on for three minutes. Wrap up now: answer briefly if they asked something, then offer once - to put them through to a person if someone is free or coming, a call back if nobody is, or to text them the link - and ask which they would like. When they answer, end the call with the action that fits. Do not start anything new.';

/** Where the limits are counted: the real clock, or a fake one in tests. */
export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ConversationSetup {
  callId: number;
  /** `buildInstructions` for this call. */
  instructions: string;
  /** What Twilio said when the lead picked up - `welcomeGreeting`. */
  greeting: string;
  hours: CallHours;
  /** The script's stop line, and its stop words. */
  stopLine: string;
  optOutWords: readonly string[];
}

export interface ConversationDeps {
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
  /** Notes kept after her turn: a sentence replaced, an action refused. */
  notes: Omit<Turn, 'callId'>[];
  replaced: boolean;
  action: string | null;
  done: boolean;
  /** The wait for OpenAI's first word (A12). */
  timer: unknown;
  /** "One moment..." was said: OpenAI was slow. */
  filler: boolean;
}

export class Conversation {
  private readonly history: ChatCompletionMessageParam[];
  /** What the lead has said that is not yet in the history: it goes in with the next reply's note of who is there. */
  private pending: string[] = [];
  private reply: Reply | null = null;
  private over = false;
  private readonly now: () => Date;
  private readonly timers: Timers;
  /** The limits are counting. */
  private started = false;
  /** Twilio's speaker events (`events="speaker-events"`, A13): the silence counts only while nobody talks. */
  private agentSpeaking = false;
  private leadSpeaking = false;
  private silenceTimer: unknown = null;
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

  constructor(
    private readonly setup: ConversationSetup,
    private readonly deps: ConversationDeps
  ) {
    this.history = [
      { role: 'system', content: setup.instructions },
      // As the voice was sent it, warmly: she reads back her own tone, and keeps to it.
      { role: 'assistant', content: greetingWithTone(setup.greeting) },
    ];
    this.now = deps.now ?? (() => new Date());
    this.timers = deps.timers ?? realTimers;
  }

  /** The session has been ended: nothing more is said. */
  get isOver(): boolean {
    return this.over;
  }

  /** What OpenAI would be sent now - for tests. */
  get messages(): readonly ChatCompletionMessageParam[] {
    return this.history;
  }

  /** Twilio is saying her greeting: the limits start counting (A12). */
  start(): void {
    if (this.started || this.over) return;
    this.started = true;
    this.callTimer = this.timers.set(() => this.callTimeUp(), LIMITS.callMs);
    this.watchSilence();
  }

  /** Twilio's speaker events: who is talking now. */
  speaking(who: 'agent' | 'client', on: boolean): void {
    if (this.over) return;
    if (who === 'agent') this.agentSpeaking = on;
    else this.leadSpeaking = on;
    if (on) this.stopSilence();
    else this.watchSilence();
  }

  /** The lead finished saying something. */
  heard(said: string): void {
    if (this.over) return;
    const heardAt = Date.now();
    this.askedStillThere = false;
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
    if (this.reply) this.finish(this.reply, { heard });
    // Her reply was all written - Twilio was still saying it.
    else if (heard) this.replaceLastSaid(heard);
    this.afterReply();
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
    if (this.reply) {
      this.timers.clear(this.reply.timer);
      this.reply.abort.abort();
    }
  }

  /** What she said last, as OpenAI reads it back - the greeting before her first reply. */
  private lastReply(): string {
    for (let i = this.history.length - 1; i > 0; i--) {
      const message = this.history[i];
      if (message.role === 'assistant') return typeof message.content === 'string' ? message.content : '';
    }
    return '';
  }

  private replaceLastSaid(heard: string): void {
    for (let i = this.history.length - 1; i > 0; i--) {
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
      notes: [],
      replaced: false,
      action: null,
      done: false,
      timer: null,
      filler: false,
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
      this.history.push(...leadTurn(reply.who, this.pending.join(' '), this.lastReply()));
      this.pending = [];
    }
    if (this.wrapUp === 'due') {
      this.wrapUp = 'given';
      this.history.push({ role: 'system', content: WRAP_UP_NOTE });
      log.info('ai_relay.wrap_up', { callId: this.setup.callId });
    }

    const splitter = new SentenceSplitter();
    let tool: ModelToolCall | null = null;
    // Everything she wrote, brackets and all: an action written instead of taken is in it.
    let written = '';
    try {
      for await (const event of this.deps.model.reply([...this.history], reply.abort.signal)) {
        if (reply.done) return;
        if (reply.firstWordAt === null) {
          reply.firstWordAt = Date.now();
          this.timers.clear(reply.timer);
        }
        if (event.type === 'tool') {
          tool ??= event.call;
          continue;
        }
        written += event.text;
        for (const sentence of splitter.push(event.text)) {
          if (!this.speak(reply, sentence)) break;
        }
        if (reply.replaced) break;
      }
      if (reply.done) return;
      if (!reply.replaced) {
        for (const sentence of splitter.flush()) {
          if (!this.speak(reply, sentence)) break;
        }
      }
    } catch (err) {
      if (reply.done) return; // stopped on purpose: talked over, the lead said more, too slow
      log.error('ai_relay.model_failed', { callId: this.setup.callId, err: errText(err) });
      this.fail('model_failed');
      return;
    }
    if (reply.done) return;

    // She wrote her action instead of taking it: taken all the same (actions.ts).
    if (!tool) {
      const action = writtenAction(written);
      if (action) {
        tool = { id: '', ...action };
        log.warn('ai_relay.written_action', { callId: this.setup.callId, action: action.name });
      }
    }

    // A replaced sentence asked whether they want a specialist: the action
    // waits for the answer.
    if (tool && !reply.replaced) {
      this.act(reply, tool, opts.attempt);
      return;
    }
    if (reply.sent.length === 0) log.warn('ai_relay.empty_reply', { callId: this.setup.callId });
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
    const said = check.reason ? check.say : withTone(sentence);
    this.deps.send(textMessage(`${said} `, false));
    reply.sent.push(said);
    reply.firstSentAt ??= Date.now();
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
    const result = toHandoff({ name: tool.name, arguments: tool.arguments }, { whoIsThere: reply.who, hours: this.setup.hours, now, said: words });

    if (result.ok) {
      const line = lineToAdd(result.handoff, words, { stopLine: this.setup.stopLine, now });
      if (line) {
        this.deps.send(textMessage(`${line} `, false));
        reply.sent.push(line);
        reply.firstSentAt ??= Date.now();
      }
      this.finish(reply);
      this.end(result.handoff);
      return;
    }

    // Refused: she is told why, in the history OpenAI reads.
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
  private finish(reply: Reply, how: { heard?: string; cut?: true; inHistory?: true } = {}): void {
    if (reply.done) return;
    reply.done = true;
    this.timers.clear(reply.timer);
    reply.abort.abort();
    if (this.reply === reply) this.reply = null;

    // With her tone: what OpenAI wrote, and reads back in its history. Kept on
    // record as her words alone - the tone is how they were said (tone.ts).
    const said = reply.sent.join(' ');
    // The filler opened her utterance too: it is closed whatever came after it.
    if ((said || reply.filler) && how.heard === undefined) this.deps.send(textMessage('', true));
    if (said) {
      this.deps.keep({ who: 'seri', text: spokenWords(said), latencyMs: Math.max(0, (reply.firstSentAt ?? Date.now()) - reply.heardAt) });
      if (!how.inHistory) {
        const heard = how.heard === undefined ? said : how.heard;
        if (heard) this.history.push({ role: 'assistant', content: heard });
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
      stopped: how.heard !== undefined ? 'talked_over' : how.cut ? 'lead_said_more' : null,
      filler: reply.filler,
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

  /** Counts the silence from now, while nobody is talking and she is not answering. */
  private watchSilence(): void {
    this.stopSilence();
    if (!this.started || this.over || this.reply || this.agentSpeaking || this.leadSpeaking) return;
    this.silenceTimer = this.timers.set(() => this.silent(), LIMITS.silenceMs);
  }

  private stopSilence(): void {
    if (this.silenceTimer !== null) this.timers.clear(this.silenceTimer);
    this.silenceTimer = null;
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
    log.info('ai_relay.still_there', { callId: this.setup.callId });
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
    const line = lastLine(handoff, { stopLine: this.setup.stopLine, now: this.now() });
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
    this.timers.clear(this.callTimer);
    this.timers.clear(this.wrapUpTimer);
    this.callTimer = null;
    this.wrapUpTimer = null;
  }
}
