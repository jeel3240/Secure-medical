/**
 * The hold watcher, and offering a lead on hold to whoever comes free - T16
 * and T17, docs/AUTO-CALLS.md "The hold line".
 *
 * A lead waiting on hold hears a classical track, 5 to 10 minutes long, and
 * Twilio asks `/auto/hold` again only when it ends. So the server acts for
 * itself, cutting the music short through Twilio's API:
 *
 * - **Someone free** - the lead who has waited longest rings them alone
 *   (`offerWaiting`): whenever a browser says it can take a call - at once
 *   when its note is saved or skipped, and on its 30-second report - or the
 *   switch is turned on (`api/calls.ts`), and on every look here.
 * - **Every 30 seconds** a lead who should not wait any more - nobody coming
 *   for them, or the safety stop - is sent back to `/auto/hold`, which says
 *   the busy line. Who waits on is left alone: cutting the music to say the
 *   place again would restart the same piece.
 *
 * In the api, not the worker: it is part of a call that is live, which the
 * api's webhooks are answering, and it runs only while automated calls are on
 * (`api/index.ts`).
 */

import { holdGoesOn } from '../core/call-script';
import type { Offer, OfferOutcome } from '../db/hold-offers';
import { errText, log } from '../lib/log';

/** How often it looks. */
export const HOLD_CHECK_MS = 30_000;

/** Offering a lead on hold - the database and Twilio, replaced in tests. */
export interface OfferDeps {
  /** Writes the next offer - only to `only`, when given. */
  startOffer: (only: number | null) => Promise<Offer | null>;
  /** Cuts the lead's music and rings the offer's person. True when Twilio took it. */
  sendToOffer: (offer: Offer) => Promise<boolean>;
  endOffer: (callId: number, offerId: number, outcome: OfferOutcome) => Promise<number | null>;
}

/** What one look reads and does. */
export interface HoldWatchDeps extends OfferDeps {
  endStaleOffers: () => Promise<number>;
  callsOnHold: () => Promise<{ callId: number; callSid: string; waitedSeconds: number; offerLive: boolean }[]>;
  someoneComing: (callId: number) => Promise<boolean>;
  readHoldMaxSeconds: () => Promise<number>;
  /** Sends the call back to `/auto/hold` now. True when Twilio took it. */
  recheckHold: (callSid: string, callId: number) => Promise<boolean>;
  /**
   * Asks Twilio whether a call it would not take is over, and if so ends it
   * here as its own end report would have - true when it did.
   */
  closeIfOver: (callSid: string, callId: number) => Promise<boolean>;
}

/**
 * Offers leads on hold to whoever is free, longest waiting first, until there
 * is nobody or nothing left - or, with `only`, one offer to the person who
 * has just come free (T17). An offer Twilio would not take is ended `unsent`,
 * and never made again to that person. Returns how many rang.
 */
export async function offerWaiting(deps: OfferDeps, only: number | null = null): Promise<number> {
  let rang = 0;
  for (;;) {
    const offer = await deps.startOffer(only);
    if (!offer) return rang;
    const sent = await deps.sendToOffer(offer);
    log.info('auto_call.offer', { callId: offer.callId, offerId: offer.offerId, agentId: offer.agentId, sent });
    if (sent) rang += 1;
    else await deps.endOffer(offer.callId, offer.offerId, 'unsent');
    if (only !== null) return rang;
  }
}

/**
 * One look: stale offers ended, leads offered to whoever is free, then each
 * lead still waiting with nobody coming, or past the safety stop, sent back
 * to `/auto/hold` - or, when Twilio says that call is over, ended here.
 * Returns how many were sent back.
 */
export async function checkHolds(deps: HoldWatchDeps): Promise<number> {
  await deps.endStaleOffers();
  await offerWaiting(deps);
  const waiting = await deps.callsOnHold();
  if (waiting.length === 0) return 0;
  const maxSeconds = await deps.readHoldMaxSeconds();
  let sent = 0;
  for (const call of waiting) {
    if (call.offerLive) continue;
    const someoneComing = await deps.someoneComing(call.callId);
    if (holdGoesOn({ waitedSeconds: call.waitedSeconds, maxSeconds, someoneComing })) continue;
    const ok = await deps.recheckHold(call.callSid, call.callId);
    log.info('auto_call.hold_recheck', {
      callId: call.callId,
      reason: someoneComing ? 'waited_too_long' : 'nobody_coming',
      sent: ok,
    });
    if (ok) sent += 1;
    // Twilio would not take it: most often the call is over and its end
    // report never reached us - the lead hung up as the api restarted. Left,
    // it would look on hold for ever, and the robot places nothing while
    // anyone is (T20). Ended here from Twilio's own record.
    else if (await deps.closeIfOver(call.callSid, call.callId)) {
      log.warn('auto_call.hold_closed', { callId: call.callId });
    }
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
