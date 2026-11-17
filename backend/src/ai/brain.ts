/**
 * The new brain on the call - Phase 7, A30, docs/AI-AGENT.md section 12:
 * understand, decide, speak, behind the same `SeriModel` the call already
 * asks (`conversation.ts`). One per call: it keeps the call's record.
 *
 * The call is unchanged around it - the stop check, every sentence checked,
 * "One moment..." and the fallback, being talked over, the three minutes, the
 * voicemail verdict, and every action checked again by `toHandoff` before it
 * is taken. Each time the call asks for her reply, the brain:
 *
 *   1. reads what happened since its last reply from the call's history: what
 *      the lead heard of that reply - the record keeps only the moves heard
 *      (`markSaid`); nothing heard, the decision is dropped - an action
 *      refused (a policy fault, `ai_policy.guard`), the three minutes;
 *   2. understands the lead's words - a bare yes or no without OpenAI;
 *   3. decides (`policy.ts`);
 *   4. says the approved answers itself, word for word, then streams speak's
 *      words for the rest - an ending's questions never said - then the
 *      action, as the call's tool call.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { CallHours } from '../core/auto-dial';
import { spokenNumber } from '../core/call-script';
import { log } from '../lib/log';
import type { Handoff } from './actions';
import { leadTimeZone, toLocalTime } from './callback-time';
import { STILL_THERE_LINE, WRAP_UP_NOTE } from './conversation';
import type { WhoIsThere } from './instructions';
import type { Knowledge } from './knowledge';
import type { ModelEvent, SeriModel, SpeakModel, UnderstandModel } from './openai';
import { asks, decide, markOpening, markSaid, startState, wrapUpDue, type Act, type CallState, type Move } from './policy';
import { SentenceSplitter } from './sentences';
import { answerLine, needsSpeak, replyBrief, speakMessages, speakSystem } from './speak';
import { spokenWords } from './tone';
import { fastPath, parseActs, understandFormat, understandMessages, UnderstandError } from './understand';

export interface BrainSetup {
  callId: number;
  knowledge: Knowledge;
  lead: { firstName: string | null; phone: string };
  now: () => Date;
  hours: CallHours;
  /** The number she gives when asked how to call back, E.164. */
  callbackNumber: string;
  /** A call picked back up after the line dropped: the record as it stood (A31). */
  record?: CallState | null;
  /** Picked back up with no record kept: past the opening, they said it is them, no question open. */
  resumed?: boolean;
}

export interface BrainModels {
  understand: UnderstandModel;
  speak: SpeakModel;
}

/** The note the call puts before each lead turn - "[Who is there: someone free] ..." (instructions.ts). */
const LEAD_TURN = /^\[Who is there: (someone free|someone coming|nobody)\]\s*/;
const WHO: Record<string, WhoIsThere> = { 'someone free': 'free', 'someone coming': 'coming', nobody: 'nobody' };

/** One reply decided and not yet heard: what the record becomes once it is. */
interface Pending {
  state: CallState;
  moves: Move[];
  /** How many of her turns the history held when it was decided: hers is the next. */
  herTurns: number;
}

export class Brain implements SeriModel {
  private state: CallState;
  private pending: Pending | null = null;
  private readonly system: string;
  private readonly leadZone: string;

  constructor(
    private readonly setup: BrainSetup,
    private readonly models: BrainModels
  ) {
    this.leadZone = leadTimeZone(setup.lead.phone).zone;
    this.system = speakSystem({ knowledge: setup.knowledge, lead: setup.lead, now: setup.now(), hours: setup.hours });
    this.state = setup.record ?? (setup.resumed ? { ...startState(), stage: 'talking', identity: true, open: null } : startState());
  }

  /** The call's record as it stands - kept with each reply (A31). */
  get record(): CallState {
    return this.state;
  }

  async *reply(messages: ChatCompletionMessageParam[], signal: AbortSignal): AsyncIterable<ModelEvent> {
    const turn = this.readHistory(messages);
    const who = turn.who;
    const now = this.setup.now();
    const context = { who, now, hours: this.setup.hours, leadZone: this.leadZone, knowledge: this.setup.knowledge };

    let acts: Act[];
    const started = Date.now();
    const fast = turn.refused ? null : fastPath(turn.said, this.state.open);
    if (turn.refused) {
      // An action refused by the call's own check: the policy was wrong. Its safe move, never the action.
      log.warn('ai_policy.guard', { callId: this.setup.callId });
      acts = [];
    } else {
      acts = fast ?? (await this.understand(turn, signal));
    }
    const decision = decide(this.state, acts, context);
    const moves = turn.refused ? decision.moves.filter((m) => m.move !== 'end') : decision.moves;
    const ending = moves.find((m): m is Extract<Move, { move: 'end' }> => m.move === 'end');
    // Never a word said: what kind of turn it was, and how long understanding took.
    log.info('ai_brain.turn', {
      callId: this.setup.callId,
      understood: turn.refused ? 'refused' : fast ? 'fast' : 'openai',
      understandMs: fast || turn.refused ? 0 : Date.now() - started,
      acts: acts.length,
      moves: moves.map((m) => m.move).join(','),
      action: ending?.handoff.action ?? null,
    });
    this.pending = { state: decision.state, moves, herTurns: turn.herTurns };

    // The approved answers first, said by code - the client's words exactly.
    for (const m of moves) {
      if (m.move !== 'answer' || m.again) continue;
      yield { type: 'text', text: `${answerLine(m.id, m.text, spokenNumber(this.setup.callbackNumber))} ` };
    }

    if (needsSpeak(moves) && !(ending && ending.handoff.action === 'opt_out')) {
      const brief = replyBrief(moves, decision.state, who, this.setup.lead.firstName);
      const stream = this.models.speak.stream(speakMessages(this.system, turn.recent, brief), signal);
      if (ending) {
        // A last line never asks: a sentence with a question is not said (call 95).
        const splitter = new SentenceSplitter();
        const keep = (sentences: string[]) => sentences.filter((s) => !spokenWords(s).includes('?'));
        for await (const text of stream) for (const s of keep(splitter.push(text))) yield { type: 'text', text: `${s} ` };
        for (const s of keep(splitter.flush())) yield { type: 'text', text: `${s} ` };
      } else {
        for await (const text of stream) yield { type: 'text', text };
      }
    }
    if (ending) yield { type: 'tool', call: { id: `brain-${this.setup.callId}`, name: ending.handoff.action, arguments: JSON.stringify(this.toolArguments(ending.handoff)) } };
  }

  /** What happened since the last reply, read from the call's own history. */
  private readHistory(messages: ChatCompletionMessageParam[]): {
    said: string;
    who: WhoIsThere;
    refused: boolean;
    herTurns: number;
    recent: { who: 'lead' | 'seri'; text: string }[];
    seri: string;
  } {
    const hers = messages.filter((m) => m.role === 'assistant');
    const refused = messages[messages.length - 1]?.role === 'tool';
    // Her last reply, as the lead heard it - the call keeps only what Twilio says was heard when she is talked over.
    // Heard whole, every move counts; cut off, only what she stated, not the question she never finished; not heard
    // at all, the decision is dropped. An action the call refused was never taken.
    if (this.pending) {
      const heard = hers[this.pending.herTurns];
      const text = heard ? spokenWords(String(heard.content ?? '')) : '';
      if (text && text !== STILL_THERE_LINE) {
        const whole = /[.!?]["')\]]?$/.test(text);
        const moves = this.pending.moves.filter((m) => (whole || !asks(m)) && !(refused && m.move === 'end'));
        this.state = markOpening(markSaid(this.pending.state, moves), text);
      }
      this.pending = null;
    }
    const lastHers = messages.reduce((at, m, i) => (m.role === 'assistant' ? i : at), -1);
    const since = messages.slice(lastHers + 1);
    if (since.some((m) => m.role === 'system' && m.content === WRAP_UP_NOTE)) this.state = wrapUpDue(this.state);
    const leadTurns = since.filter((m) => m.role === 'user').map((m) => String(m.content ?? ''));
    const lastTurn = leadTurns[leadTurns.length - 1] ?? '';
    const who = WHO[LEAD_TURN.exec(lastTurn)?.[1] ?? 'nobody'];
    const said = leadTurns.map((t) => t.replace(LEAD_TURN, '')).join(' ').trim();
    const recent = messages.flatMap((m): { who: 'lead' | 'seri'; text: string }[] => {
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content) return [{ who: 'seri', text: spokenWords(m.content) }];
      if (m.role === 'user' && typeof m.content === 'string') return [{ who: 'lead', text: m.content.replace(LEAD_TURN, '') }];
      return [];
    });
    const seri = recent.filter((t) => t.who === 'seri').pop()?.text ?? '';
    return { said, who, refused, herTurns: hers.length, recent, seri };
  }

  private async understand(turn: { said: string; seri: string; recent: { who: 'lead' | 'seri'; text: string }[] }, signal: AbortSignal): Promise<Act[]> {
    const before = turn.recent.slice(-5, -1);
    const messages = understandMessages(this.setup.knowledge, { said: turn.said, seri: turn.seri, before });
    const answer = await this.models.understand.understand(messages, understandFormat(this.setup.knowledge), signal);
    try {
      return parseActs(answer, this.setup.knowledge);
    } catch (err) {
      if (!(err instanceof UnderstandError)) throw err;
      // An answer it cannot read: treated as a line not made out - she asks them to say it again.
      log.warn('ai_brain.unreadable', { callId: this.setup.callId });
      return [{ act: 'unclear' }];
    }
  }

  /** The action as the call's tool call carries it - checked again by `toHandoff`. */
  private toolArguments(handoff: Handoff): Record<string, unknown> {
    switch (handoff.action) {
      case 'book_callback':
        return { time: toLocalTime(new Date(handoff.at), handoff.timeZone), time_zone: handoff.timeZone, reason: handoff.reason };
      case 'end_call':
        return { reason: handoff.reason };
      default:
        return {};
    }
  }
}

