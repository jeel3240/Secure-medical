import { callReducer, IDLE, isActive, occupiesAgent, type CallEvent, type CallState } from './call-state';

/**
 * A lead calling in, as this browser sees it, pure - TWILIO.md, "Incoming
 * calls".
 *
 *   none -> ringing -> call (answered: connecting -> live -> ended) -> none
 *               \
 *                +--> missed -> none        it rang out, or the lead hung up
 *                +--> none                  the agent declined, or a ring that
 *                                           went to several people ended
 *
 * Timestamps are passed in with the event, as in `call-state.ts`, so this
 * stays a pure function.
 *
 * Once answered it is an ordinary call, so that part is `call-state.ts`'s
 * reducer and the same call bar draws it. No Twilio in here: `lib/calling.ts`
 * raises the events and `lib/incoming-call.ts` holds the state.
 */

export interface Caller {
  /** 0 when the server did not say which lead - the bar then has no lead to open. */
  id: number;
  /** As stored; empty when the lead has no name. */
  name: string;
  phone: string;
}

/**
 * How this browser is being rung - T11, AUTO-CALLS.md. Read from what the
 * server attached to the call (`lib/calling.ts`, `ringKind`).
 */
export interface RingKind {
  /**
   * Shared (`ring=group`): rung together with other people, the first to
   * accept taking it - or, a transfer to the lead's own agent, rung alone
   * first with the others next (T15b). Over without this person answering, it
   * clears with no "Missed call": someone else took it, or it went on to the
   * others, the hold or the busy line - it was never theirs alone.
   */
  group: boolean;
  /**
   * A lead who said yes on the automated call, being put through
   * (`reason=transfer`), with the heading of the question they said yes to
   * (`step`, "Offer"). Null for any other call.
   */
  transfer: { step: string } | null;
}

/** One person rung - every call before automated calls, and every one since that is not a group. */
export const ALONE: RingKind = { group: false, transfer: null };

export type IncomingState =
  | { phase: 'none' }
  /** Ringing since `since`, ms - the card shows how long. */
  | { phase: 'ringing'; caller: Caller; since: number; kind: RingKind }
  | { phase: 'call'; caller: Caller; call: CallState }
  /** Nobody picked up, after ringing `rangSeconds`. Stays until the agent has seen it. */
  | { phase: 'missed'; caller: Caller; rangSeconds: number };

export type IncomingEvent =
  /** `kind` left out is a ring to this person alone. */
  | { type: 'ring'; caller: Caller; at: number; kind?: RingKind }
  | { type: 'ring_over'; at: number }
  | { type: 'declined' }
  | { type: 'answer' }
  /** Something happened on the answered call. */
  | { type: 'call'; event: CallEvent }
  | { type: 'dismiss' };

export const NO_CALL: IncomingState = { phase: 'none' };

/** True while this browser is ringing or on an answered call: no other call may start. */
export function isBusy(state: IncomingState): boolean {
  return state.phase === 'ringing' || (state.phase === 'call' && isActive(state.call));
}

/**
 * True while it keeps the agent from taking another call: ringing, or answered
 * and not yet done with - the note box included (`occupiesAgent`). A missed
 * call is only a notice.
 */
export function incomingOccupiesAgent(state: IncomingState): boolean {
  return state.phase === 'ringing' || (state.phase === 'call' && occupiesAgent(state.call));
}

export function incomingReducer(state: IncomingState, event: IncomingEvent): IncomingState {
  switch (event.type) {
    case 'ring':
      // A second caller while one is ringing or being spoken to is not shown;
      // they hear that we will call back. A missed call, or a finished one
      // still showing its note box, gives way to the phone that is ringing now.
      return isBusy(state) ? state : { phase: 'ringing', caller: event.caller, since: event.at, kind: event.kind ?? ALONE };

    case 'ring_over':
      if (state.phase !== 'ringing') return state;
      // A ring several people got is nobody's missed call: it clears quietly.
      if (state.kind.group) return NO_CALL;
      return {
        phase: 'missed',
        caller: state.caller,
        rangSeconds: Math.max(0, Math.round((event.at - state.since) / 1000)),
      };

    case 'declined':
      return state.phase === 'ringing' ? NO_CALL : state;

    case 'answer':
      return state.phase === 'ringing'
        ? { phase: 'call', caller: state.caller, call: callReducer(IDLE, { type: 'start' }) }
        : state;

    case 'call': {
      if (state.phase !== 'call') return state;
      const call = callReducer(state.call, event.event);
      return call.phase === 'idle' ? NO_CALL : { ...state, call };
    }

    case 'dismiss':
      return state.phase === 'missed' ? NO_CALL : state;
  }
}
