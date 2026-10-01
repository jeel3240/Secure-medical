import { callReducer, IDLE, isActive, type CallEvent, type CallState } from './call-state';

/**
 * A lead calling in, as this browser sees it, pure - TWILIO.md, "Incoming
 * calls".
 *
 *   none -> ringing -> call (answered: connecting -> live -> ended) -> none
 *               \
 *                +--> missed -> none        it rang out, or the lead hung up
 *                +--> none                  the agent declined
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

export type IncomingState =
  | { phase: 'none' }
  | { phase: 'ringing'; caller: Caller }
  | { phase: 'call'; caller: Caller; call: CallState }
  /** Nobody picked up. Stays until the agent has seen it. */
  | { phase: 'missed'; caller: Caller };

export type IncomingEvent =
  | { type: 'ring'; caller: Caller }
  | { type: 'ring_over' }
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

export function incomingReducer(state: IncomingState, event: IncomingEvent): IncomingState {
  switch (event.type) {
    case 'ring':
      // A second caller while one is ringing or being spoken to is not shown;
      // they hear that we will call back. A missed call, or a finished one
      // still showing its note box, gives way to the phone that is ringing now.
      return isBusy(state) ? state : { phase: 'ringing', caller: event.caller };

    case 'ring_over':
      return state.phase === 'ringing' ? { phase: 'missed', caller: state.caller } : state;

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
