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
import { asks, decide, markOpening, markSaid, POLICY_VERSION, startState, wrapUpDue, type Act, type CallState, type Move } from './policy';
import type { KeptTurn } from './resume';
import { SentenceSplitter } from './sentences';
import { codeLines, needsSpeak, replyBrief, speakMessages, speakSystem, timesNamed } from './speak';
import { spokenWords } from './tone';
import { actLabel, fastPath, parseActs, understandFormat, understandMessages, UnderstandError } from './understand';

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
  /** Keeps each reply's record (A31) - as a `system` turn with its data. */
  keep?: (record: BrainRecord) => void;
}

/** What is kept of each reply (A31): never a word said - the lead's acts and her moves by kind, and the call's record. */
export interface BrainRecord {
  version: number;
  /** How the lead's words were read: `fast`, `openai`, `early` - started while they spoke (A33) - or `refused`, after an action the call refused. */
  understood: 'fast' | 'openai' | 'early' | 'refused';
  acts: string[];
  moves: Move[];
  /** The record before this reply, and once it is heard whole. */
  record: CallState;
  decided: CallState;
}

/** The note the record is kept under - a `system` turn, which the timeline and resume pass over. */
export const RECORD_NOTE = 'Record of the reply (the brain)';

/**
 * The record a call picked back up starts from: the last one kept - with its
 * reply said, when her turn followed it. Null when
 * none was kept, or one from another version of the policy (A31).
 */
export function recordFromTurns(turns: readonly KeptTurn[]): CallState | null {
  const at = turns.reduce((found, t, i) => (t.who === 'system' && isRecord(t.data) ? i : found), -1);
  if (at < 0) return null;
  const kept = turns[at].data as BrainRecord;
  if (kept.version !== POLICY_VERSION) return null;
  // `decided` already holds the reply as said whole.
  const heard = turns.slice(at + 1).some((t) => t.who === 'seri');
  return heard ? kept.decided : kept.record;
}

function isRecord(data: unknown): data is BrainRecord {
  return typeof data === 'object' && data !== null && 'decided' in data && 'record' in data && 'moves' in data && 'version' in data;
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
  /** Everything the brain gave the call for it, as written - to tell how much the lead heard. */
  full: string;
}

/**
 * How much of a reply the lead must have heard, talked over, for all of it to
 * count - a question included. Call 114: the opening, cut off at "Is that
 * something you'd", counted as never said and was said again, three times; and
 * "Is it more about the timing, or just" - answered - counted as never asked.
 */
const HEARD_MOST = 0.6;

/**
 * How long the lead's words must stay the same, while they speak, before
 * understanding them starts early (A33) - a word added restarts it.
 */
export const PREFETCH_SETTLE_MS = 150;

/** Understanding started early on words still being said. */
interface Prefetch {
  key: string;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  acts: Promise<Act[]> | null;
  /** When the request went to OpenAI - null while the words settle. */
  startedAt: number | null;
}

/** Words as compared: small letters, no punctuation, single spaces. */
const wordsKey = (said: string) =>
  said
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export class Brain implements SeriModel {
  private state: CallState;
  private pending: Pending | null = null;
  private early: Prefetch | null = null;
  /** The lead's words still being said this turn (A33): how many came, and when the last did - measured, never their words. */
  private partials = 0;
  private lastPartialAt: number | null = null;
  private readonly system: string;
  private readonly leadZone: string;
  /** Whether the area code told the lead's zone - unknown, times are said as Arizona time (review H11). */
  private readonly leadZoneKnown: boolean;

  constructor(
    private readonly setup: BrainSetup,
    private readonly models: BrainModels
  ) {
    const zone = leadTimeZone(setup.lead.phone);
    this.leadZone = zone.zone;
    this.leadZoneKnown = zone.known;
    this.system = speakSystem({ knowledge: setup.knowledge, lead: setup.lead, now: setup.now(), hours: setup.hours });
    this.state = setup.record ?? (setup.resumed ? { ...startState(), stage: 'talking', identity: true, open: null } : startState());
  }

  /** The call's record as it stands - kept with each reply (A31). */
  get record(): CallState {
    return this.state;
  }

  /**
   * The lead's words while they are still speaking (A33): once they have stayed
   * the same for `PREFETCH_SETTLE_MS`, understanding them starts - asked
   * exactly as the reply would ask it, so the answer is the same. A bare yes or
   * no needs none. Newer words drop the older start.
   */
  prefetch(messages: ChatCompletionMessageParam[], said: string): void {
    this.partials += 1;
    this.lastPartialAt = Date.now();
    const key = wordsKey(said);
    if (!key || fastPath(said, 'interest') || this.early?.key === key) return;
    this.dropEarly();
    const early: Prefetch = { key, abort: new AbortController(), timer: null, acts: null, startedAt: null };
    early.timer = setTimeout(() => {
      early.timer = null;
      early.startedAt = Date.now();
      const recent = this.recentTurns(messages);
      const seri = recent.filter((t) => t.who === 'seri').pop()?.text ?? '';
      early.acts = this.askUnderstand({ said, seri, before: recent.slice(-4) }, early.abort.signal);
      // A start not used is never a failure.
      early.acts.catch(() => undefined);
    }, PREFETCH_SETTLE_MS);
    this.early = early;
  }

  private dropEarly(): void {
    if (!this.early) return;
    if (this.early.timer) clearTimeout(this.early.timer);
    this.early.abort.abort();
    this.early = null;
  }

  async *reply(messages: ChatCompletionMessageParam[], signal: AbortSignal): AsyncIterable<ModelEvent> {
    const turn = this.readHistory(messages);
    const who = turn.who;
    const now = this.setup.now();
    const context = { who, now, hours: this.setup.hours, leadZone: this.leadZone, leadZoneKnown: this.leadZoneKnown, knowledge: this.setup.knowledge };

    let acts: Act[];
    const started = Date.now();
    const fast = turn.refused ? null : fastPath(turn.said, this.state.open);
    // Understanding started early on these same words, while they were said (A33).
    const early = this.early && this.early.acts && this.early.key === wordsKey(turn.said) ? this.early.acts : null;
    const prefetched = !fast && !turn.refused && early !== null;
    // How much of a head start the words still being said gave (A33) - measured on real calls.
    const partials = this.partials;
    const lastPartialMs = this.lastPartialAt === null ? null : started - this.lastPartialAt;
    const headStartMs = prefetched && this.early?.startedAt != null ? started - this.early.startedAt : null;
    this.partials = 0;
    this.lastPartialAt = null;
    if (!prefetched) this.dropEarly();
    const earlyStart = this.early;
    this.early = null;
    if (turn.refused) {
      // An action refused by the call's own check: the policy was wrong. Its safe move, never the action.
      log.warn('ai_policy.guard', { callId: this.setup.callId });
      acts = [];
    } else if (fast) {
      acts = fast;
    } else if (early) {
      // The reply stopped - talked over, too slow, the call closed - stops the early start with it, and nothing more
      // is decided: before, an answer arriving after the lead hung up was still acted on (review H5, 2026-11-22).
      const stop = () => earlyStart?.abort.abort();
      if (signal.aborted) stop();
      signal.addEventListener('abort', stop, { once: true });
      try {
        acts = await early.catch((err: unknown) => {
          if (signal.aborted) throw err;
          return this.understand(turn, signal);
        });
      } finally {
        signal.removeEventListener('abort', stop);
      }
    } else {
      acts = await this.understand(turn, signal);
    }
    const decidedAt = Date.now();
    const decision = decide(this.state, acts, context);
    const moves = turn.refused ? decision.moves.filter((m) => m.move !== 'end') : decision.moves;
    const ending = moves.find((m): m is Extract<Move, { move: 'end' }> => m.move === 'end');
    const understood = turn.refused ? 'refused' : fast ? 'fast' : prefetched ? 'early' : 'openai';
    this.setup.keep?.({ version: POLICY_VERSION, understood, acts: acts.map(actLabel), moves, record: this.state, decided: markSaid(decision.state, moves) });
    // Never a word said: what kind of turn it was, and how long understanding took.
    log.info('ai_brain.turn', {
      callId: this.setup.callId,
      understood,
      // The wait on understanding once the lead had finished - started early, often none.
      understandMs: fast || turn.refused ? 0 : decidedAt - started,
      // Words still being said this turn, how long before the final words the last of them came, and how long understanding had already run.
      partials,
      lastPartialMs,
      headStartMs,
      acts: acts.length,
      moves: moves.map((m) => m.move).join(','),
      action: ending?.handoff.action ?? null,
    });
    const pending: Pending = { state: decision.state, moves, herTurns: turn.herTurns, full: '' };
    this.pending = pending;

    // Said by code first: the approved answers - the client's words exactly - then her saved introduction, when nothing else needs her words.
    const byCode = codeLines(moves, spokenNumber(this.setup.callbackNumber));
    for (const line of byCode) {
      pending.full += `${line} `;
      yield { type: 'text', text: `${line} ` };
    }

    if (needsSpeak(moves) && !(ending && ending.handoff.action === 'opt_out')) {
      const brief = replyBrief(moves, decision.state, who, this.setup.lead.firstName, turn.namesSaid);
      const stream = this.models.speak.stream(speakMessages(this.system, turn.recent, brief, byCode), signal);
      if (ending) {
        // A last line never asks: a sentence with a question is not said (call 95).
        const splitter = new SentenceSplitter();
        const keep = (sentences: string[]) => sentences.filter((s) => !spokenWords(s).includes('?'));
        for await (const text of stream) {
          for (const s of keep(splitter.push(text))) {
            pending.full += `${s} `;
            yield { type: 'text', text: `${s} ` };
          }
        }
        for (const s of keep(splitter.flush())) {
          pending.full += `${s} `;
          yield { type: 'text', text: `${s} ` };
        }
      } else {
        for await (const text of stream) {
          pending.full += text;
          yield { type: 'text', text };
        }
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
    namesSaid: number;
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
        // Heard most of it: all of it counts. Cut off early: what she stated, not a question they barely heard -
        // but the opening, once any of it was heard: they know who she is (call 114).
        const full = spokenWords(this.pending.full);
        const most = full.length === 0 || text.length >= HEARD_MOST * full.length;
        const moves = this.pending.moves.filter((m) => (most || !asks(m) || m.move === 'opening') && !(refused && m.move === 'end'));
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
    const recent = this.recentTurns(messages);
    const seri = recent.filter((t) => t.who === 'seri').pop()?.text ?? '';
    // Her replies since the greeting that said the lead's name - once more is enough (call 127).
    const namesSaid = timesNamed(hers.slice(1).map((m) => spokenWords(String(m.content ?? ''))), this.setup.lead.firstName);
    return { said, who, refused, herTurns: hers.length, recent, seri, namesSaid };
  }

  /** The call's turns as plain words: hers without tones, the lead's without the note of who is there. */
  private recentTurns(messages: ChatCompletionMessageParam[]): { who: 'lead' | 'seri'; text: string }[] {
    return messages.flatMap((m): { who: 'lead' | 'seri'; text: string }[] => {
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content) return [{ who: 'seri', text: spokenWords(m.content) }];
      if (m.role === 'user' && typeof m.content === 'string') return [{ who: 'lead', text: m.content.replace(LEAD_TURN, '') }];
      return [];
    });
  }

  private understand(turn: { said: string; seri: string; recent: { who: 'lead' | 'seri'; text: string }[] }, signal: AbortSignal): Promise<Act[]> {
    return this.askUnderstand({ said: turn.said, seri: turn.seri, before: turn.recent.slice(-5, -1) }, signal);
  }

  /** The understand step, asked - the same request whether started early or not. */
  private async askUnderstand(input: { said: string; seri: string; before: { who: 'lead' | 'seri'; text: string }[] }, signal: AbortSignal): Promise<Act[]> {
    const messages = understandMessages(this.setup.knowledge, input);
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

