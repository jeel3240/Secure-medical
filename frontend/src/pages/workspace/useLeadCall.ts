import { useCallback, useEffect, useReducer, useRef } from 'react';
import { callReducer, IDLE, type CallState } from '../../lib/call-state';
import { describeCallError, placeCall, type CallHandle } from '../../lib/calling';

/**
 * One lead's call, for the workspace - Phase 4, TWILIO.md.
 *
 * Joins the pure state machine (`lib/call-state.ts`) to the real call
 * (`lib/calling.ts`), and owns the two things neither can: the call must end
 * when the agent leaves the lead, and Hang up must work even before the call
 * has finished connecting.
 *
 * `onOver` runs when a call ends, and once more a little later: the server
 * learns how the call ended from Twilio a moment after the browser does, and
 * the second run is what brings the finished call onto the page.
 */

const SECOND_REFRESH_MS = 2500;
/** How long "Call ended · 2:14" stays before the button returns to Call. */
const ENDED_NOTE_MS = 8000;

export function useLeadCall(
  leadId: number,
  onOver: () => void
): {
  state: CallState;
  start: () => void;
  hangUp: () => void;
  setMuted: (muted: boolean) => void;
} {
  const [state, dispatch] = useReducer(callReducer, IDLE);

  const handle = useRef<CallHandle | null>(null);
  /** True from the click until the call is over: no second call meanwhile. */
  const busy = useRef(false);
  /** Hang up was pressed - possibly before `handle` existed. */
  const hangUpAsked = useRef(false);
  const mounted = useRef(true);
  const onOverRef = useRef(onOver);
  useEffect(() => {
    onOverRef.current = onOver;
  }, [onOver]);

  const finish = useCallback(() => {
    handle.current = null;
    busy.current = false;
    if (!mounted.current) return;
    onOverRef.current();
    window.setTimeout(() => mounted.current && onOverRef.current(), SECOND_REFRESH_MS);
  }, []);

  const start = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    hangUpAsked.current = false;
    dispatch({ type: 'start' });

    placeCall(leadId, {
      onRinging: () => dispatch({ type: 'ringing' }),
      onAnswered: () => dispatch({ type: 'answered', at: Date.now() }),
      onMuted: (muted) => dispatch({ type: 'muted', muted }),
      onEnded: () => {
        dispatch({ type: 'ended', at: Date.now(), byAgent: hangUpAsked.current });
        finish();
      },
      onFailed: (message) => {
        dispatch({ type: 'failed', message });
        finish();
      },
    })
      .then((placed) => {
        handle.current = placed;
        // Hang up was pressed, or the page was left, while it was connecting.
        if (hangUpAsked.current) placed.hangUp();
      })
      .catch((err: unknown) => {
        dispatch({ type: 'failed', message: describeCallError(err) });
        handle.current = null;
        busy.current = false;
      });
  }, [leadId, finish]);

  const hangUp = useCallback(() => {
    hangUpAsked.current = true;
    handle.current?.hangUp();
  }, []);

  const setMuted = useCallback((muted: boolean) => handle.current?.setMuted(muted), []);

  // Leaving the lead ends its call: an agent must never be on a call with a
  // lead whose page they are no longer looking at.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      hangUpAsked.current = true;
      handle.current?.hangUp();
    };
  }, [leadId]);

  // The result is shown for a moment, then the button is simply Call again.
  useEffect(() => {
    if (state.phase !== 'ended') return;
    const timer = window.setTimeout(() => dispatch({ type: 'reset' }), ENDED_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [state.phase]);

  return { state, start, hangUp, setMuted };
}
