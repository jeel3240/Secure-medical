import { useEffect } from 'react';

/**
 * Whether anything on this browser's screen keeps its agent from taking a
 * call - T9, AUTO-CALLS.md "Who is free".
 *
 * A call being placed or live, a lead ringing, or a finished call's note box
 * still open each mark the browser busy under their own name, and clear it
 * when they end. `lib/calling.ts` reads the whole and tells the server, every
 * half minute and at once when it changes, so a transfer never rings someone
 * who is talking or still writing up the last call.
 *
 * Kept apart from both calls' state - the lead's call is a page's hook, the
 * incoming call a store - so neither has to know about the other, and this
 * file knows about neither.
 */

const busy = new Set<string>();
const listeners = new Set<() => void>();

/** True while anything on screen is a call, a ring or an after-call note. */
export function isBrowserBusy(): boolean {
  return busy.size > 0;
}

/**
 * Marks `what` as keeping the browser busy, or no longer. The listeners hear
 * only when the whole changes: a second reason to be busy is not news.
 */
export function setBusy(what: string, isBusy: boolean): void {
  const before = isBrowserBusy();
  if (isBusy) busy.add(what);
  else busy.delete(what);
  if (isBrowserBusy() !== before) listeners.forEach((listener) => listener());
}

/** Runs `listener` whenever the browser becomes busy or free. Returns how to stop. */
export function onBusyChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For a component: `what` keeps the browser busy while `active`, and never once it is gone. */
export function useBusyWhile(what: string, active: boolean): void {
  useEffect(() => {
    setBusy(what, active);
    return () => setBusy(what, false);
  }, [what, active]);
}
