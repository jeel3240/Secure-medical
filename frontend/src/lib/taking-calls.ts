import type { TakingCallsState } from '../api/calls';
import { useAuth } from '../auth/store';

/**
 * The "Taking calls" switch as the server holds it - T10, and T15c,
 * AUTO-CALLS.md "Who is free".
 *
 * The server turns it off by itself when the person lets a transfer ring out,
 * and the screen learns it from the answer to the browser's 30-second report
 * (`lib/calling.ts`). That answer may have left before a switch made here
 * reached the server: one that crossed a switch made here is not taken - the
 * switch's own answer is the newer word.
 */

/** Bumped when a switch made here starts, and again when it is answered. */
let switchedHere = 0;

/** A switch is being made here: answers already on their way are older. */
export function markSwitchedHere(): void {
  switchedHere += 1;
}

/** Where the switches made here stand - taken when a report is sent. */
export function switchMark(): number {
  return switchedHere;
}

/**
 * Takes the server's word on the switch into the signed-in user - unless a
 * switch was made here since the report carrying it was sent (`mark`).
 */
export function takeServerSwitch(state: TakingCallsState, mark: number): void {
  if (mark !== switchedHere) return;
  const { user, setUser } = useAuth.getState();
  if (!user) return;
  if (user.takingCalls === state.takingCalls && user.takingCallsWhy === state.takingCallsWhy) return;
  setUser({ ...user, takingCalls: state.takingCalls, takingCallsWhy: state.takingCallsWhy });
}

/** Off because the person let a transfer ring out: the app bar says so (T15c). */
export function missedTransfer(state: TakingCallsState): boolean {
  return !state.takingCalls && state.takingCallsWhy === 'missed_transfer';
}
