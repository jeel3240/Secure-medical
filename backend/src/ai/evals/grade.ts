/**
 * The answer test set's cases and how a reply is marked - Phase 7, A09,
 * docs/AI-AGENT.md section 8. Pure: `run.ts` asks OpenAI, this decides.
 *
 * A case is a call so far, built the way the relay will build it (A11): the
 * instructions, the greeting Twilio said, then each turn - the lead's with the
 * note of who is there before it. A reply passes when its outcome - no action
 * yet, or the action she took, checked as the relay checks it - is one the
 * case allows, and her words hold what they must and nothing they must not,
 * nor anything the sentence check would replace. Her words are what the lead
 * hears - her tones taken out, as the relay keeps them - and a bracket that is
 * not one of her tones fails (tone.ts).
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { DEFAULT_CALL_HOURS } from '../../core/auto-dial';
import { ANTIBIOTICS_CALL } from '../../core/call-script-fixtures';
import { ACTIONS, lineToAdd, toHandoff, writtenAction, type ToolCall } from '../actions';
import { leadTurn } from '../conversation';
import { buildInstructions, welcomeGreeting, type WhoIsThere } from '../instructions';
import type { Knowledge } from '../knowledge';
import { checkSentence } from '../safety';
import { greetingWithTone, hasTone, spokenWords, strayBrackets } from '../tone';
import casesFile from './cases.json';

/** Production's number: what Seri reads out when asked how to call back. */
const CALLBACK_NUMBER = '+14804708259';

export type Outcome = 'none' | (typeof ACTIONS)[number];
export const OUTCOMES: readonly Outcome[] = ['none', ...ACTIONS];

type Turn = { lead: string } | { seri: string };

export interface EvalCase {
  id: string;
  who: WhoIsThere;
  /** The lead has answered the greeting and heard the opening. */
  opened: boolean;
  lead: { firstName: string | null; phone: string };
  now: Date;
  turns: Turn[];
  /** The outcomes that pass. */
  expect: Outcome[];
  endReason?: string;
  /** For a call back: the instant it must be booked for. */
  callbackAt?: string;
  /** At least one of these is said - whole words, any case. */
  mustSayAny: string[];
  /** None of these is said - the defaults and the case's own. */
  mustNotSay: string[];
}

interface RawCase {
  id: string;
  who?: string;
  opened?: boolean;
  lead?: { firstName: string | null; phone: string };
  /** When the call happens, if not the default's - a Friday afternoon, say (A21, call 93). */
  now?: string;
  turns: Turn[];
  expect: string[];
  end_reason?: string;
  callback_at?: string;
  must_say_any?: string[];
  must_not_say?: string[];
}

/** Every case, with the defaults filled in. */
export function loadCases(): EvalCase[] {
  const { defaults } = casesFile;
  return (casesFile.cases as RawCase[]).map((c) => ({
    id: c.id,
    who: (c.who ?? defaults.who) as WhoIsThere,
    opened: c.opened ?? defaults.opened,
    lead: c.lead ?? defaults.lead,
    now: new Date(c.now ?? defaults.now),
    turns: c.turns,
    expect: c.expect as Outcome[],
    endReason: c.end_reason,
    callbackAt: c.callback_at,
    mustSayAny: c.must_say_any ?? [],
    mustNotSay: [...defaults.must_not_say, ...(c.must_not_say ?? [])],
  }));
}

/** The conversation as OpenAI gets it - as a call sends it (`Conversation`, A11). */
export function caseMessages(c: EvalCase, knowledge: Knowledge): ChatCompletionMessageParam[] {
  const instructions = buildInstructions({
    knowledge,
    lead: c.lead,
    now: c.now,
    hours: DEFAULT_CALL_HOURS,
    callbackNumber: CALLBACK_NUMBER,
    stopLine: ANTIBIOTICS_CALL.optOutBody,
  });
  const turns: Turn[] = [...(c.opened ? [{ lead: casesFile.opening.lead }, { seri: casesFile.opening.seri }] : []), ...c.turns];
  const greeting = greetingWithTone(welcomeGreeting(c.lead.firstName));
  // Empty until her first reply, as on a call (`lastReply`, conversation.ts).
  let herLast = '';
  return [
    { role: 'system', content: instructions },
    { role: 'assistant', content: greeting },
    ...turns.flatMap((t): ChatCompletionMessageParam[] => {
      if ('lead' in t) return leadTurn(c.who, t.lead, herLast);
      herLast = t.seri;
      return [{ role: 'assistant', content: t.seri }];
    }),
  ];
}

/** Her reply the lead's last turn answered, as the relay reads it (`answeredReply`, conversation.ts): her words. */
export function answeredReply(c: EvalCase): string {
  const turns: Turn[] = [...(c.opened ? [{ lead: casesFile.opening.lead }, { seri: casesFile.opening.seri }] : []), ...c.turns];
  let last = welcomeGreeting(c.lead.firstName);
  let answered = last;
  for (const t of turns) {
    if ('seri' in t) last = t.seri;
    else answered = last;
  }
  return spokenWords(answered);
}

/** What Seri answered: her words, and any action she took. */
export interface Reply {
  text: string;
  toolCalls: ToolCall[];
}

export interface Grade {
  outcome: string;
  problems: string[];
  /** What the lead hears: her words, or the action's own last line when she said none. */
  heard: string;
  /** The relay added a line after hers: the action's own, or the stop line. */
  defaultLine: boolean;
  /** She gave at least one sentence a tone. */
  toned: boolean;
  /** She wrote her action in brackets rather than taking it - taken all the same, as the relay does. */
  wroteAction: boolean;
}

/** Whether `phrase` is in `text`: as whole words when it starts and ends with one, else anywhere. Any case. */
export function says(text: string, phrase: string): boolean {
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  const p = phrase.toLowerCase();
  if (!/^\w/.test(p) || !/\w$/.test(p)) return t.includes(p);
  return new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t);
}

export function grade(c: EvalCase, reply: Reply): Grade {
  const problems: string[] = [];
  // A made-up tone, or the who-is-there note read back: the relay drops it,
  // but it should never be written - the voice may say an unknown one aloud.
  // An action written in brackets is taken by the relay, and counted instead.
  const written = reply.toolCalls.length === 0 ? writtenAction(reply.text) : null;
  for (const bracket of strayBrackets(reply.text)) {
    if (!writtenAction(bracket)) problems.push(`not one of her tones: ${bracket}`);
  }
  const said = spokenWords(reply.text);
  let text = said;
  let added = false;
  const [action, ...more] = written ? [written] : reply.toolCalls;
  const result = action ? toHandoff(action, { whoIsThere: c.who, hours: DEFAULT_CALL_HOURS, now: c.now, said, before: answeredReply(c) }) : null;
  // An action after a question is held back, as the relay does: the call goes
  // on with the lead's answer - no action yet.
  const outcome = !action || (result && !result.ok && result.awaitLead) ? 'none' : action.name;

  if (more.length > 0) problems.push(`more than one action: ${reply.toolCalls.map((t) => t.name).join(', ')}`);
  if (!(c.expect as string[]).includes(outcome)) problems.push(`${outcome}, expected ${c.expect.join(' or ')}`);

  if (action && result && outcome !== 'none') {
    if (!result.ok) {
      problems.push(`refused: ${result.error}`);
    } else {
      const handoff = result.handoff;
      if (handoff.action === 'end_call' && c.endReason && handoff.reason !== c.endReason) {
        problems.push(`ended for ${handoff.reason}, expected ${c.endReason}`);
      }
      if (handoff.action === 'book_callback' && c.callbackAt && handoff.at !== c.callbackAt) {
        problems.push(`booked for ${handoff.at}, expected ${c.callbackAt}`);
      }
      const line = lineToAdd(handoff, said, { stopLine: ANTIBIOTICS_CALL.optOutBody, now: c.now });
      if (line) {
        text = `${said} ${line}`.trim();
        added = true;
      }
    }
    if (outcome === 'opt_out' && !says(text, 'we will not call you again')) problems.push('opted out without the stop line');
  } else if (!text) {
    problems.push('said nothing');
  }

  if (c.mustSayAny.length > 0 && !c.mustSayAny.some((p) => says(text, p))) {
    problems.push(`said none of: ${c.mustSayAny.join(' / ')}`);
  }
  for (const p of c.mustNotSay) if (says(text, p)) problems.push(`said "${p}"`);
  for (const sentence of text.split(/(?<=[.?!])\s+/).filter(Boolean)) {
    const check = checkSentence(sentence);
    if (check.reason) problems.push(`would be replaced (${check.reason}, "${check.found}"): ${sentence}`);
  }
  return { outcome, problems, heard: text, defaultLine: added, toned: hasTone(reply.text), wroteAction: writtenAction(reply.text) !== null };
}
