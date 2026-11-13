/**
 * What follows Seri's part of the call - A14, docs/AI-AGENT.md section 3.
 * Pure: `/auto/ai-after` reads Twilio's request, asks this, and carries it
 * out with today's code.
 *
 * Twilio asks `/auto/ai-after` when the ConversationRelay session ends, with
 * `SessionStatus`:
 *
 * - `ended` - we ended it, her action in `HandoffData` (`fromHandoff`);
 * - `failed` - Twilio's side, or our socket, failed: the script takes the call;
 * - `completed` - the lead hung up. Whatever she had already ended the call
 *   with is still carried out where it needs no one on the line - a stop
 *   blocks the number, a link is texted - as a stop or a "yes" said as the
 *   lead hangs up is on today's script (`handleAnswer`). That is the action
 *   the relay recorded (`recordedHandoff`), since Twilio sends none.
 *
 * She has said her last line in her own voice, so nothing here says one for
 * her: only the recording notice before a transfer, the hold or busy line
 * when the transfer reaches them, and - when she failed - a word of sorry
 * before the script's first question.
 */

import { splitForListening, type AskOrEnd, type CallResult, type CallScript } from '../core/call-script';
import type { Handoff } from './actions';

/** Said in the script's voice when Seri failed, before the script's first question. */
export const FALLBACK_LINE = 'Sorry about that.';

/** How the session ended, as Twilio says it. Anything else reads as `failed`. */
export type SessionStatus = 'ended' | 'failed' | 'completed';

export function sessionStatus(raw: string): SessionStatus {
  return raw === 'ended' || raw === 'completed' ? raw : 'failed';
}

export type AfterSeri =
  /** Put through to a person: the recording notice, then today's transfer (`planTransfer`). */
  | { kind: 'transfer' }
  /** The script takes the call: sorry, then its first question - not its greeting, she has said hers. */
  | { kind: 'script' }
  /**
   * The call ends, nothing more said. `result` is saved once - null when the
   * lead hung up before anything was decided, which the call's end saves as
   * `hung_up`. `blockNumber`: she heard a stop. `sendLink`: text it, once.
   * `callback`: hers, booked - saved by A15.
   */
  | {
      kind: 'end';
      result: CallResult | null;
      blockNumber: boolean;
      sendLink: boolean;
      callback: Extract<Handoff, { action: 'book_callback' }> | null;
    };

const ending = (result: CallResult | null, extra: Partial<Omit<Extract<AfterSeri, { kind: 'end' }>, 'kind' | 'result'>> = {}): AfterSeri => ({
  kind: 'end',
  result,
  blockNumber: false,
  sendLink: false,
  callback: null,
  ...extra,
});

/**
 * What follows her action - `handoff`, null when she ended with none - with
 * the lead still on the line or not (`hungUp`). As section 3's table:
 *
 * - `transfer_to_agent`: today's transfer; `transferred` or `transfer_missed`
 *   is decided by the ring, as on the script. The lead gone, it reaches
 *   nobody: `hung_up`, as a "yes" said while hanging up on the script.
 * - `book_callback`: `callback_booked`.
 * - `send_link`: `link_sent`, the link texted.
 * - `opt_out`: `opted_out`, the number blocked.
 * - `end_call`: `not_interested` - whatever reason she gave, which is kept
 *   with her action - except the relay's `no_response`, the lead silent after
 *   "are you still there?", which is the script's `no_response`; and, as on
 *   the script, no `no_response` for a lead who hung up.
 * - `fallback`: the script, from its first question; the lead gone, nothing.
 */
export function afterSeri(handoff: Handoff | null, hungUp: boolean): AfterSeri {
  if (handoff === null) return ending(null);
  switch (handoff.action) {
    case 'transfer_to_agent':
      return hungUp ? ending(null) : { kind: 'transfer' };
    case 'book_callback':
      return ending('callback_booked', { callback: handoff });
    case 'send_link':
      return ending('link_sent', { sendLink: true });
    case 'opt_out':
      return ending('opted_out', { blockNumber: true });
    case 'end_call':
      if (handoff.reason === 'no_response') return ending(hungUp ? null : 'no_response');
      return ending('not_interested');
    case 'fallback':
      return hungUp ? ending(null) : { kind: 'script' };
  }
}

/**
 * The script taking the call from Seri: sorry, then its first step's question
 * alone - its greeting and offer are left out, since she has introduced
 * herself - listening as on any first asking. An answer then goes to
 * `/auto/gather` and the call carries on exactly as today. A script with no
 * steps: null, and the call ends.
 */
export function fallbackAsk(script: CallScript): AskOrEnd | null {
  const first = script.steps[0];
  if (!first) return null;
  const { question } = splitForListening([first.body]);
  return { kind: 'ask', step: first, attempt: 1, say: [FALLBACK_LINE, question || first.body] };
}
