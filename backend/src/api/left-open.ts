/**
 * Calls left open - review H4, 2026-11-22, TWILIO.md "Calls whose end never
 * came". A call Twilio placed whose end never reached us - the api restarting
 * at a deploy as Twilio reported it - kept no outcome for good: no result on
 * Admin > Leads, and a person who took it counted as on a call for two hours
 * (`ON_A_CALL_SQL`), every "yes" waiting on hold meanwhile. Calls on hold were
 * already ended from Twilio's record (`hold-watch.ts`); calls never placed by
 * the robot (`closeUnplacedCalls`). Every other is now: once a call has been
 * open `LEFT_OPEN_MINUTES`, Twilio is asked how it ended, every
 * `LEFT_OPEN_CHECK_MS`, and a call Twilio says is over is ended as its own
 * callback would have ended it. One still going is left alone.
 */

import type { CallOutcome } from '../core/calls';
import { outcomeForStatus, talkSeconds } from '../core/calls';
import { errText, log } from '../lib/log';

/** How long a call is open before Twilio is asked whether it is over - longer than a ring and a hold together. */
export const LEFT_OPEN_MINUTES = 15;
/** How often those calls are looked at. */
export const LEFT_OPEN_CHECK_MS = 5 * 60_000;

export interface CloseDeps {
  /** How Twilio says the call ended - null while it is still going, or when Twilio cannot say. */
  callEnd: (callSid: string) => Promise<{ status: string; durationSec: number } | null>;
  finishCall: (opts: { callSid: string; outcome: CallOutcome; durationSec: number }) => Promise<unknown>;
  settleAutomatedCall: (callId: number) => Promise<void>;
}

/**
 * Ends a call from Twilio's own record of it, as `/status` and `/auto/status`
 * would have: its outcome and length, then an automated call's result. True
 * when Twilio says it is over. Shared by the hold watcher and the sweep below.
 */
export function closeFromTwilio(deps: CloseDeps): (callSid: string, callId: number) => Promise<boolean> {
  return async (callSid, callId) => {
    const end = await deps.callEnd(callSid);
    const outcome = end && outcomeForStatus(end.status);
    if (!end || !outcome) return false;
    await deps.finishCall({ callSid, outcome, durationSec: talkSeconds(outcome, end.durationSec) });
    await deps.settleAutomatedCall(callId);
    return true;
  };
}

export interface LeftOpenDeps {
  callsLeftOpen: () => Promise<{ callId: number; callSid: string }[]>;
  closeIfOver: (callSid: string, callId: number) => Promise<boolean>;
}

/** One look: each call left open asked about, one failing never stopping the rest. How many were ended. */
export async function closeLeftOpen(deps: LeftOpenDeps): Promise<number> {
  let closed = 0;
  for (const call of await deps.callsLeftOpen()) {
    try {
      if (await deps.closeIfOver(call.callSid, call.callId)) {
        closed += 1;
        log.warn('call.closed_late', { callId: call.callId });
      }
    } catch (err) {
      log.error('call.close_late_failed', { callId: call.callId, err: errText(err) });
    }
  }
  return closed;
}

/** Looks every `everyMs` until the returned function is called. One look at a time. */
export function watchLeftOpen(deps: LeftOpenDeps, everyMs = LEFT_OPEN_CHECK_MS): () => void {
  let looking = false;
  const timer = setInterval(() => {
    if (looking) return;
    looking = true;
    closeLeftOpen(deps)
      .catch((err) => log.error('call.left_open_watch_failed', { err: errText(err) }))
      .finally(() => {
        looking = false;
      });
  }, everyMs);
  return () => clearInterval(timer);
}
