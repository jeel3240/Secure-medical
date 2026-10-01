/**
 * A browser call's states, pure - Phase 4, TWILIO.md.
 *
 *   idle -> connecting -> ringing -> live -> ended
 *                 \          \         \
 *                  +----------+---------+--> ended | failed
 *
 * No Twilio in here: `lib/calling.ts` turns the SDK's events into these
 * events, and the screen renders the state. Kept apart so every transition is
 * tested without a microphone or a network.
 *
 * Timestamps are milliseconds, passed in with the event rather than read from
 * the clock here, so the reducer stays a pure function.
 */

export type CallState =
  | { phase: 'idle' }
  /** Asking for a token, opening the device, reaching Twilio. */
  | { phase: 'connecting' }
  /** The lead's phone is ringing. */
  | { phase: 'ringing' }
  /** The lead answered at `since`. */
  | { phase: 'live'; since: number; muted: boolean }
  /** Over. `seconds` of conversation if it was answered, otherwise why not. */
  | { phase: 'ended'; result: 'talked'; seconds: number }
  | { phase: 'ended'; result: 'no_answer' | 'canceled' }
  /** It never started, or broke: a sentence the agent can act on. */
  | { phase: 'failed'; message: string };

export type CallEvent =
  | { type: 'start' }
  | { type: 'ringing' }
  | { type: 'answered'; at: number }
  | { type: 'muted'; muted: boolean }
  /** `byAgent`: the agent pressed Hang up, as opposed to the call ending on its own. */
  | { type: 'ended'; at: number; byAgent: boolean }
  | { type: 'failed'; message: string }
  | { type: 'reset' };

export const IDLE: CallState = { phase: 'idle' };

/** True while a call is being placed or is live - when a second one must not start. */
export function isActive(state: CallState): boolean {
  return state.phase === 'connecting' || state.phase === 'ringing' || state.phase === 'live';
}

export function callReducer(state: CallState, event: CallEvent): CallState {
  switch (event.type) {
    case 'start':
      // A second click while one is in flight changes nothing.
      return isActive(state) ? state : { phase: 'connecting' };

    case 'ringing':
      return state.phase === 'connecting' ? { phase: 'ringing' } : state;

    case 'answered':
      return state.phase === 'connecting' || state.phase === 'ringing'
        ? { phase: 'live', since: event.at, muted: false }
        : state;

    case 'muted':
      return state.phase === 'live' ? { ...state, muted: event.muted } : state;

    case 'ended':
      if (state.phase === 'live') {
        return { phase: 'ended', result: 'talked', seconds: Math.max(0, Math.round((event.at - state.since) / 1000)) };
      }
      if (state.phase === 'connecting' || state.phase === 'ringing') {
        // Never answered: the agent gave up, or the phone rang out.
        return { phase: 'ended', result: event.byAgent ? 'canceled' : 'no_answer' };
      }
      return state;

    case 'failed':
      return { phase: 'failed', message: event.message };

    case 'reset':
      return isActive(state) ? state : IDLE;
  }
}

/** `0:07`, `2:14`, `1:02:05` - a call's length, as a clock. */
export function callClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = String(s % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** What the screen says once a call is over. */
export function endedText(state: Extract<CallState, { phase: 'ended' }>): string {
  if (state.result === 'talked') return `Call ended · ${callClock(state.seconds)}`;
  return state.result === 'canceled' ? 'Call cancelled' : 'No answer';
}

/**
 * Why the Call button is off, or null when it may be pressed. One sentence, as
 * a tooltip - the order is the order an agent can fix them in.
 */
export function callBlockedReason(opts: {
  enabled: boolean | null;
  holdsLead: boolean;
  onDncList: boolean;
}): string | null {
  if (opts.onDncList) return 'This number is on the do-not-call list.';
  if (opts.enabled === null) return 'Checking whether calling is available…';
  if (!opts.enabled) return 'Calling is not set up on this server.';
  if (!opts.holdsLead) return 'Pick up this lead to call it.';
  return null;
}
