/**
 * One call's conversation with Seri - A11, docs/AI-AGENT.md sections 1-3.
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
 * said, then each turn - built as the answer test set builds it (`leadMessage`,
 * evals/grade.ts), so what is tested is what calls use.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { CallHours } from '../core/auto-dial';
import { saysStop } from '../core/answers';
import { errText, log } from '../lib/log';
import { handoffData, lineToAdd, toHandoff, type Handoff } from './actions';
import { whoIsThereNote, type WhoIsThere } from './instructions';
import type { ModelToolCall, SeriModel } from './openai';
import { endMessage, refusedNote, replacedNote, stopNote, textMessage } from './relay-messages';
import type { Turn } from './relay-store';
import { checkSentence } from './safety';
import { SentenceSplitter } from './sentences';

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
  now?: () => Date;
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
}

export class Conversation {
  private readonly history: ChatCompletionMessageParam[];
  /** What the lead has said that is not yet in the history: it goes in with the next reply's note of who is there. */
  private pending: string[] = [];
  private reply: Reply | null = null;
  private over = false;
  private readonly now: () => Date;

  constructor(
    private readonly setup: ConversationSetup,
    private readonly deps: ConversationDeps
  ) {
    this.history = [
      { role: 'system', content: setup.instructions },
      { role: 'assistant', content: setup.greeting },
    ];
    this.now = deps.now ?? (() => new Date());
  }

  /** The session has been ended: nothing more is said. */
  get isOver(): boolean {
    return this.over;
  }

  /** What OpenAI would be sent now - for tests. */
  get messages(): readonly ChatCompletionMessageParam[] {
    return this.history;
  }

  /** The lead finished saying something. */
  heard(said: string): void {
    if (this.over) return;
    const heardAt = Date.now();
    if (saysStop(said, this.setup.optOutWords)) {
      this.optOut('words');
      return;
    }
    this.pending.push(said);
    // Something she was still writing is dropped: the lead has said more.
    if (this.reply) this.finish(this.reply, { cut: true });
    void this.respond({ heardAt, attempt: 0 });
  }

  /** The lead pressed a key. Only the stop key means anything to her. */
  pressed(digit: string): void {
    if (this.over || digit !== STOP_KEY) return;
    this.optOut('key');
  }

  /** The lead spoke over her: `heard` is what she had said by then. */
  interrupted(heard: string): void {
    if (this.over) return;
    if (this.reply) {
      this.finish(this.reply, { heard });
      return;
    }
    // Her reply was all written - Twilio was still saying it.
    if (!heard) return;
    for (let i = this.history.length - 1; i > 0; i--) {
      const message = this.history[i];
      if (message.role === 'assistant') {
        this.history[i] = { ...message, content: heard };
        return;
      }
    }
  }

  /** The WebSocket closed. */
  close(): void {
    this.over = true;
    this.reply?.abort.abort();
  }

  private async respond(opts: { heardAt: number; attempt: number; who?: WhoIsThere }): Promise<void> {
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
    };
    this.reply = reply;

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

    const splitter = new SentenceSplitter();
    let tool: ModelToolCall | null = null;
    try {
      for await (const event of this.deps.model.reply([...this.history], reply.abort.signal)) {
        if (reply.done) return;
        reply.firstWordAt ??= Date.now();
        if (event.type === 'tool') {
          tool ??= event.call;
          continue;
        }
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
      if (reply.done) return; // stopped on purpose: talked over, or the lead said more
      // What happens on the call is A12's: for now she says no more.
      log.error('ai_relay.model_failed', { callId: this.setup.callId, err: errText(err) });
      this.finish(reply);
      return;
    }
    if (reply.done) return;

    // A replaced sentence asked whether they want a specialist: the action
    // waits for the answer.
    if (tool && !reply.replaced) {
      this.act(reply, tool, opts.attempt);
      return;
    }
    if (reply.sent.length === 0) log.warn('ai_relay.empty_reply', { callId: this.setup.callId });
    this.finish(reply);
  }

  /** Checks one sentence and sends it - or the specialist line in its place, ending the reply. */
  private speak(reply: Reply, sentence: string): boolean {
    const check = checkSentence(sentence);
    this.deps.send(textMessage(`${check.say} `, false));
    reply.sent.push(check.say);
    reply.firstSentAt ??= Date.now();
    if (!check.reason) return true;
    reply.replaced = true;
    reply.notes.push({ who: 'system', text: replacedNote(check.reason, check.found, sentence) });
    reply.abort.abort();
    return false;
  }

  private act(reply: Reply, tool: ModelToolCall, attempt: number): void {
    const said = reply.sent.join(' ');
    const now = this.now();
    reply.action = tool.name;
    const result = toHandoff({ name: tool.name, arguments: tool.arguments }, { whoIsThere: reply.who, hours: this.setup.hours, now, said });

    if (result.ok) {
      const line = lineToAdd(result.handoff, said, { stopLine: this.setup.stopLine, now });
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
    if (result.awaitLead || attempt + 1 >= MAX_ACTION_TRIES) return;
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
    reply.abort.abort();
    if (this.reply === reply) this.reply = null;

    const said = reply.sent.join(' ');
    if (said) {
      if (how.heard === undefined) this.deps.send(textMessage('', true));
      this.deps.keep({ who: 'seri', text: said, latencyMs: Math.max(0, (reply.firstSentAt ?? Date.now()) - reply.heardAt) });
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
    });
  }

  /** The lead asked to stop: the script's stop line, then the opt-out - whatever she was saying. */
  private optOut(via: 'words' | 'key'): void {
    if (this.reply) this.finish(this.reply, { cut: true });
    this.deps.keep({ who: 'system', text: stopNote(via) });
    this.deps.send(textMessage(this.setup.stopLine, true));
    this.deps.keep({ who: 'seri', text: this.setup.stopLine, latencyMs: 0 });
    this.end({ action: 'opt_out' });
  }

  private end(handoff: Handoff): void {
    this.over = true;
    this.deps.keep({ who: 'action', text: handoffData(handoff) });
    this.deps.ended(handoff);
    this.deps.send(endMessage(handoff));
    log.info('ai_relay.ended', { callId: this.setup.callId, action: handoff.action });
  }
}
