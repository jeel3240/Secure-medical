/**
 * Seri's five actions - Phase 7, A06, docs/AI-AGENT.md section 3. Defined
 * once here: what OpenAI is offered (`ACTION_TOOLS`), what a tool call becomes
 * (`toHandoff`), and what Twilio hands back to `/auto/ai-after` (`fromHandoff`),
 * so the relay and the page that carries the action out agree. Pure.
 *
 * Every call ends with exactly one: she says her last line, the relay ends the
 * ConversationRelay session with the action as `handoffData`, and Twilio posts
 * it back as `HandoffData` (A11, A14). A tool call that cannot be carried out -
 * a call back at 8 PM, a transfer with nobody there - is refused with words
 * that tell her what to offer instead, and the call goes on.
 *
 * `fallback` is not hers: the relay ends with it when she fails (A12), and
 * anything unreadable handed back reads as it, so the call falls back to the
 * script rather than to nothing.
 */

import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions';
import type { CallHours } from '../core/auto-dial';
import { isTimeZone } from '../db/sql';
import { atLocalTime, checkCallbackTime, MAX_AHEAD_DAYS, MIN_AHEAD_MINUTES, saysClock, spokenTime, toLocalTime, type CallbackRefusal } from './callback-time';
import type { WhoIsThere } from './instructions';

export const ACTIONS = ['transfer_to_agent', 'book_callback', 'send_link', 'opt_out', 'end_call'] as const;
export type ActionName = (typeof ACTIONS)[number];

/** Why she ended the call with `end_call` - kept with the action. */
export const END_REASONS = ['not_interested', 'wrong_person', 'emergency', 'other'] as const;
export type EndReason = (typeof END_REASONS)[number];

/**
 * Why the relay itself ended the call with `end_call` (A12): the lead stayed
 * silent after "are you still there?", or the call ran past its time. Never
 * offered to OpenAI - only the relay ends a call for these.
 */
export const RELAY_END_REASONS = ['no_response', 'time_limit'] as const;
export type RelayEndReason = (typeof RELAY_END_REASONS)[number];

/** A call back's reason, as she gives it: one short line for the agent who takes it. */
const MAX_REASON_LENGTH = 200;

/** What the session ends with, and `/auto/ai-after` carries out. */
export type Handoff =
  | { action: 'transfer_to_agent' }
  | {
      action: 'book_callback';
      /** The instant, ISO - the same however it was said. */
      at: string;
      /** The zone she and the lead agreed it in - how it is said back to them, and shown. */
      timeZone: string;
      reason: string;
    }
  | { action: 'send_link' }
  | { action: 'opt_out' }
  | { action: 'end_call'; reason: EndReason | RelayEndReason }
  | { action: 'fallback'; why: string };

// ---------------------------------------------------------------------------
// What OpenAI is offered

const noArguments = { type: 'object', properties: {}, required: [], additionalProperties: false };

const tool = (name: ActionName, description: string, parameters: Record<string, unknown>): ChatCompletionFunctionTool => ({
  type: 'function',
  function: { name, description, parameters, strict: true },
});

/** The five actions, as OpenAI tools. Strict: the arguments always match the schema. */
export const ACTION_TOOLS: ChatCompletionFunctionTool[] = [
  tool(
    'transfer_to_agent',
    'Put the lead through to a person now. Only when the lead wants to order now or wants a person, and someone is free or coming. Say your last line first: "Great, connecting you now."',
    noArguments
  ),
  tool(
    'book_callback',
    'Book a call from a person at a time the lead agreed, after you confirmed it out loud in their own time zone and said goodbye. The time must be inside the agent hours.',
    {
      type: 'object',
      properties: {
        time: {
          type: 'string',
          description: 'The date and time the lead agreed, as their own clock reads it: YYYY-MM-DDTHH:MM, for example 2026-11-12T15:00.',
        },
        time_zone: {
          type: 'string',
          description: 'The lead\'s time zone, as an IANA name, for example America/New_York.',
        },
        reason: {
          type: 'string',
          description: 'One short line for the person who calls back, for example "Wants to order antibiotics".',
        },
      },
      required: ['time', 'time_zone', 'reason'],
      additionalProperties: false,
    }
  ),
  tool('send_link', 'Text the lead a link to look for themselves. Say first that it is on its way, and goodbye.', noArguments),
  tool('opt_out', 'The lead asked not to be called again. Say the stop line first. Never ask why or try to change their mind.', noArguments),
  tool(
    'end_call',
    'End the call: not interested after two clear no\'s, the wrong person, a medical emergency, or the call is done. Say goodbye first.',
    {
      type: 'object',
      properties: { reason: { type: 'string', enum: [...END_REASONS] } },
      required: ['reason'],
      additionalProperties: false,
    }
  ),
];

// ---------------------------------------------------------------------------
// A tool call, turned into a handoff - or refused, for Seri to put right

export interface ToolCall {
  name: string;
  /** As OpenAI sends them: a JSON string. */
  arguments: string;
}

const WRITTEN_ACTION = new RegExp(`\\[\\s*(?:functions\\.)?(${ACTIONS.join('|')})\\s*(?:[:(]\\s*(\\{[^\\][]*\\})?\\s*\\)?)?\\s*\\]`);

/**
 * An action she wrote in square brackets instead of taking it - "[send_link]",
 * "[functions.book_callback:{...}]". Seen on the answer test set (A09) once
 * her tones put brackets in her words (A21): now and then the action went in
 * them too, and once it was not taken at all - she said a call back was
 * booked, and none was. The relay takes it as if she had, through the same
 * checks (`toHandoff`); the bracket itself is never said (tone.ts). Null when
 * there is none.
 */
export function writtenAction(text: string): ToolCall | null {
  const match = WRITTEN_ACTION.exec(text);
  return match ? { name: match[1], arguments: match[2] ?? '{}' } : null;
}

/** What a tool call is checked against: this turn's view of the call. */
export interface ActionContext {
  whoIsThere: WhoIsThere;
  /** The agents' hours - `readCallHours`. */
  hours: CallHours;
  now: Date;
  /** What she said in this reply before the action. */
  said: string;
  /**
   * Her reply the lead has just answered - her words. A call back is booked
   * only for a time named in it: she said it back, and they said yes (A21,
   * call 92 - a "yes" to being put through, with nobody free, was booked for a
   * time she chose herself).
   */
  before: string;
}

export type ActionResult =
  | { ok: true; handoff: Handoff }
  | {
      ok: false;
      /** Words for Seri, sent back as the tool's result: what is wrong, and what to do instead. */
      error: string;
      /**
       * Her reply asked the lead something: nothing more is said now, and the
       * call goes on with the lead's answer. Any other refusal, she speaks
       * again at once, with what to offer.
       */
      awaitLead?: true;
    };

const REFUSED: Record<CallbackRefusal, string> = {
  past: 'That time has already passed.',
  too_soon: `That is too soon: a call back must be at least ${MIN_AHEAD_MINUTES} minutes away.`,
  too_far: `That is too far ahead: call backs are booked up to ${MAX_AHEAD_DAYS} days ahead.`,
  outside_hours: 'That is outside the agent hours.',
};

export function toHandoff(call: ToolCall, context: ActionContext): ActionResult {
  // Found by the answer test set (A09): the model asks "Would you like me to
  // connect you?" and transfers in the same reply. A question is answered
  // before anything ends the call - wherever it is in the reply: on A21's call
  // 89 she asked "Is it more the timing, or just not something you need right
  // now?", offered the link and texted it in the same reply, before the lead
  // could answer. Except a stop, taken at once every time: on A21's test runs
  // she opted a lead out and then said her greeting again, and the question
  // held the stop back.
  if (call.name !== 'opt_out' && context.said.includes('?') && (ACTIONS as readonly string[]).includes(call.name)) {
    return {
      ok: false,
      awaitLead: true,
      error: `Not done: your reply asked the lead a question. Wait for their answer, and take ${call.name} in a later reply if it still fits.`,
    };
  }

  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.arguments || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    args = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, error: `The arguments for ${call.name} could not be read. Try again.` };
  }

  switch (call.name) {
    case 'transfer_to_agent':
      if (context.whoIsThere === 'nobody') {
        return {
          ok: false,
          error:
            'Nobody can take a call right now, so do not transfer. Tell the lead everyone is busy, and ask when would be a good time for a call back, inside the agent hours. Book it with book_callback only once you have said their time back to them and they have said yes.',
        };
      }
      return { ok: true, handoff: { action: 'transfer_to_agent' } };

    case 'book_callback':
      return bookCallback(args, context);

    case 'send_link':
      return { ok: true, handoff: { action: 'send_link' } };

    case 'opt_out':
      return { ok: true, handoff: { action: 'opt_out' } };

    case 'end_call': {
      const reason = (END_REASONS as readonly unknown[]).includes(args.reason) ? (args.reason as EndReason) : null;
      if (!reason) return { ok: false, error: `end_call needs a reason: one of ${END_REASONS.join(', ')}.` };
      return { ok: true, handoff: { action: 'end_call', reason } };
    }

    default:
      return { ok: false, error: `There is no action called ${call.name}. Use one of: ${ACTIONS.join(', ')}.` };
  }
}

/** A call back she never said back to the lead - told to her instead of booking it. */
export const NOT_AGREED =
  'Not booked: they have not agreed this time with you. Ask when suits them, inside the agent hours, then say the day and time back to them in their time zone and ask them to confirm. Book it once they say yes.';

function bookCallback(args: Record<string, unknown>, { hours, now, before }: ActionContext): ActionResult {
  const zone = typeof args.time_zone === 'string' ? args.time_zone.trim() : '';
  if (!isTimeZone(zone)) {
    return { ok: false, error: 'time_zone must be the lead\'s time zone as an IANA name, for example America/New_York.' };
  }
  const when = typeof args.time === 'string' ? atLocalTime(args.time, zone) : null;
  if (!when) {
    return { ok: false, error: 'time must be the date and time the lead agreed, as their own clock reads it: YYYY-MM-DDTHH:MM, for example 2026-11-12T15:00.' };
  }
  const reason = typeof args.reason === 'string' ? args.reason.trim().replace(/\s+/g, ' ') : '';
  if (!reason || reason.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `reason must be one short line for the person who calls back, at most ${MAX_REASON_LENGTH} characters.` };
  }

  const check = checkCallbackTime(when, zone, hours, now);
  if (!check.ok) {
    const offer = check.offer
      ? ` Offer ${spokenTime(check.offer, zone, now)} instead, and if they agree, book it as ${toLocalTime(check.offer, zone)}.`
      : ' Offer to text them the link instead.';
    return { ok: false, error: `Not booked. ${REFUSED[check.why]}${offer}` };
  }
  // The time must be the one she said back to them, which they then agreed.
  if (!saysClock(before, when, zone)) return { ok: false, error: NOT_AGREED };
  return { ok: true, handoff: { action: 'book_callback', at: when.toISOString(), timeZone: zone, reason } };
}

/**
 * What the relay says after Seri's own words, before the session ends (A11) -
 * found by the answer test set (A09). The lead always hears a last line, and
 * an opt-out always ends with the stop line:
 * - she took the action with no words: the action's own last line, in her voice;
 * - she opted out without the stop line: the stop line;
 * - otherwise nothing - her words were the last line.
 */
export function lineToAdd(handoff: Handoff, said: string, context: { stopLine: string; now: Date }): string | null {
  if (!said.trim()) return lastLine(handoff, context);
  if (handoff.action === 'opt_out' && !normalised(said).includes(normalised(context.stopLine))) return context.stopLine;
  return null;
}

const normalised = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * An action's own last line, said when Seri gave none. A call back's says the
 * time it was booked for, as checked. Null for `fallback`, which says nothing
 * of its own.
 */
export function lastLine(handoff: Handoff, { stopLine, now }: { stopLine: string; now: Date }): string | null {
  switch (handoff.action) {
    case 'transfer_to_agent':
      return 'Great, connecting you now.';
    case 'book_callback':
      return `Perfect, someone from our team will call you ${spokenTime(new Date(handoff.at), handoff.timeZone, now)}. Have a great day!`;
    case 'send_link':
      return "I'll text you the link now. Have a great day!";
    case 'opt_out':
      return stopLine;
    case 'end_call':
      switch (handoff.reason) {
        case 'wrong_person':
          return 'Sorry about that, have a great day.';
        case 'emergency':
          return 'If this is a medical emergency, please hang up and call 911.';
        case 'no_response':
          return 'Sorry I missed you, have a great day.';
        case 'time_limit':
          return 'Thanks so much for your time today. Have a great day!';
        default:
          return 'Thanks for your time. Have a great day!';
      }
    case 'fallback':
      return null;
  }
}

/**
 * The relay's own ending, when Seri failed (A12) - `why`: `model_failed`
 * (OpenAI errored), `model_slow` (no first word in 8 seconds), `socket_error`,
 * `relay_failed`. `/auto/ai-after` then goes on with the script (A14).
 */
export function fallbackHandoff(why: string): Handoff {
  return { action: 'fallback', why };
}

// ---------------------------------------------------------------------------
// Across Twilio and back

/** What the relay sends as `handoffData` when it ends the session. */
export function handoffData(handoff: Handoff): string {
  return JSON.stringify(handoff);
}

/**
 * Twilio's `HandoffData`, posted to `/auto/ai-after`, read safely: whatever is
 * missing, malformed or unknown is a `fallback` - never a throw, and never a
 * guess at an action.
 */
export function fromHandoff(raw: unknown): Handoff {
  if (typeof raw !== 'string' || raw.trim() === '') return fallbackHandoff('no_handoff');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fallbackHandoff('unreadable_handoff');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return fallbackHandoff('unreadable_handoff');
  const h = data as Record<string, unknown>;

  switch (h.action) {
    case 'transfer_to_agent':
    case 'send_link':
    case 'opt_out':
      return { action: h.action };
    case 'end_call':
      return ([...END_REASONS, ...RELAY_END_REASONS] as readonly unknown[]).includes(h.reason)
        ? { action: 'end_call', reason: h.reason as EndReason | RelayEndReason }
        : fallbackHandoff('unreadable_handoff');
    case 'book_callback': {
      const at = typeof h.at === 'string' && /^\d{4}-\d\d-\d\dT/.test(h.at) ? new Date(h.at) : null;
      const reason = typeof h.reason === 'string' ? h.reason.trim() : '';
      const valid = at && !Number.isNaN(at.getTime()) && isTimeZone(h.timeZone) && reason && reason.length <= MAX_REASON_LENGTH;
      return valid
        ? { action: 'book_callback', at: at.toISOString(), timeZone: h.timeZone as string, reason }
        : fallbackHandoff('unreadable_handoff');
    }
    case 'fallback':
      return fallbackHandoff(typeof h.why === 'string' && h.why ? h.why.slice(0, MAX_REASON_LENGTH) : 'unknown');
    default:
      return fallbackHandoff('unknown_action');
  }
}
