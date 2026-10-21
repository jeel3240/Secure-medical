/**
 * The hold watcher - T16, docs/AUTO-CALLS.md "The hold line".
 *
 * A lead waiting on hold hears a classical track, 5 to 10 minutes long, and
 * Twilio asks `/auto/hold` again only when it ends. So every 30 seconds the
 * server looks for itself: a lead who should not wait any more - nobody who
 * takes transfers is on a call now, or they have waited the safety stop's
 * length - is sent back to `/auto/hold` at once, cutting the music short;
 * that webhook decides and says the busy line. Who waits on is left alone:
 * cutting the music to say the place again would restart the same piece.
 *
 * In the api, not the worker: it is part of a call that is live, which the
 * api's webhooks are answering, and it runs only while automated calls are on
 * (`api/index.ts`).
 */

import { holdGoesOn } from '../core/call-script';
import { errText, log } from '../lib/log';

/** How often it looks. */
export const HOLD_CHECK_MS = 30_000;

/** What it reads and does - the database and Twilio, replaced in tests. */
export interface HoldWatchDeps {
  callsOnHold: () => Promise<{ callId: number; callSid: string; waitedSeconds: number }[]>;
  someoneOnCall: () => Promise<boolean>;
  readHoldMaxSeconds: () => Promise<number>;
  /** Sends the call back to `/auto/hold` now. True when Twilio took it. */
  recheckHold: (callSid: string, callId: number) => Promise<boolean>;
}

/**
 * One look: each lead who should not wait any more is sent back to
 * `/auto/hold`. Returns how many were.
 */
export async function checkHolds(deps: HoldWatchDeps): Promise<number> {
  const waiting = await deps.callsOnHold();
  if (waiting.length === 0) return 0;
  const [onCall, maxSeconds] = await Promise.all([deps.someoneOnCall(), deps.readHoldMaxSeconds()]);
  let sent = 0;
  for (const call of waiting) {
    if (holdGoesOn({ waitedSeconds: call.waitedSeconds, maxSeconds, onCall })) continue;
    const ok = await deps.recheckHold(call.callSid, call.callId);
    log.info('auto_call.hold_recheck', {
      callId: call.callId,
      reason: onCall ? 'waited_too_long' : 'nobody_on_a_call',
      sent: ok,
    });
    if (ok) sent += 1;
  }
  return sent;
}

/** Looks every `everyMs` until the returned function is called. One look at a time. */
export function watchHolds(deps: HoldWatchDeps, everyMs = HOLD_CHECK_MS): () => void {
  let looking = false;
  const timer = setInterval(() => {
    if (looking) return;
    looking = true;
    checkHolds(deps)
      .catch((err) => log.error('auto_call.hold_watch_failed', { err: errText(err) }))
      .finally(() => {
        looking = false;
      });
  }, everyMs);
  return () => clearInterval(timer);
}
