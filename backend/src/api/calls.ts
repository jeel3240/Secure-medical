/**
 * `GET /api/calls/config` and `POST /api/calls/token` - what the browser needs
 * to place a call. Phase 4, TWILIO.md. And for automated calls (AUTO-CALLS.md,
 * "Who is free"): `POST /api/calls/ringable` - whether this browser can take a
 * call now (T9) - and `POST /api/calls/taking-calls`, the switch (T10). Either
 * saying someone is free now offers them a lead waiting on hold (T17).
 *
 * Signed-in users only. The token lets a browser place calls as that agent
 * through our TwiML App, nothing more; which lead it may call is decided per
 * call by the voice webhook, which checks the agent holds that lead.
 */

import { Router } from 'express';
import { requireAuth, requirePasswordChanged } from './auth/middleware';
import type { AppDeps } from './deps';
import { asyncHandler, HttpError } from './http';
import { mintCallToken, TOKEN_TTL_SECONDS } from '../integrations/twilio';
import { errText, log } from '../lib/log';
import { offerWaiting } from './hold-watch';
import { recordTakingCalls } from './taking-calls';

/**
 * Someone has just come free - their browser says so (note saved or skipped)
 * or they switched "Taking calls" on: a lead waiting on hold rings them now
 * (T17, AUTO-CALLS.md "The hold line"), rather than at the hold watcher's
 * next look. After the answer to the browser, and never a reason for it to
 * fail. Nothing happens unless automated calls are on, someone is on hold,
 * and the person is free.
 */
function offerHoldTo(deps: AppDeps, userId: number): void {
  if (!deps.autoCalls || !deps.twilio) return;
  const settings = deps.twilio;
  // Loaded lazily, as the routes' SQL is - see the note in `/ringable`.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const offers = require('../db/hold-offers') as typeof import('../db/hold-offers');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const twilioCalls = require('../integrations/twilio-calls') as typeof import('../integrations/twilio-calls');
  offerWaiting(
    {
      startOffer: offers.startOffer,
      sendToOffer: (offer) => twilioCalls.sendToOffer(settings, offer.callSid, offer.callId, offer.offerId),
      endOffer: offers.endOffer,
    },
    userId
  ).catch((err) => log.error('auto_call.offer_failed', { userId, err: errText(err) }));
}

export function callsRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requirePasswordChanged);

  /**
   * Whether calling is set up, and the number leads will see - for the Call
   * button; and whether automated calls are on - for the "Taking calls" switch.
   */
  router.get('/config', (_req, res) => {
    res.json({ enabled: deps.twilio !== null, callerId: deps.twilio?.callerId ?? null, autoCalls: deps.autoCalls });
  });

  router.post(
    '/token',
    asyncHandler(async (req, res) => {
      if (!deps.twilio) {
        throw new HttpError(503, 'calling_off', 'Calling is not set up on this server.');
      }
      const { token, identity } = mintCallToken(deps.twilio, req.user!.id);
      log.info('call.token_issued', { userId: req.user!.id });
      res.json({ token, identity, ttlSeconds: TOKEN_TTL_SECONDS });
    })
  );

  /**
   * "I can take a call now" - or not - from a signed-in browser, every 30
   * seconds and whenever it changes. `db/presence.ts`. Not logged (LOGGING.md):
   * it would be two lines a minute per agent, saying nothing new.
   */
  router.post(
    '/ringable',
    asyncHandler(async (req, res) => {
      if (!deps.twilio) {
        throw new HttpError(503, 'calling_off', 'Calling is not set up on this server.');
      }
      const available = (req.body as { available?: unknown } | undefined)?.available;
      if (typeof available !== 'boolean') {
        throw new HttpError(400, 'invalid_available', 'available must be true or false.');
      }
      // Loaded lazily, as the other routes' SQL is: ../db/pool pulls in config,
      // which exits the process when an env var is missing - that would break
      // the route tests, which build the app without a full environment.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { pool } = require('../db/pool') as typeof import('../db/pool');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const presence = require('../db/presence') as typeof import('../db/presence');
      // Answered with the switch as the server holds it, so a browser learns
      // within half a minute that it was turned off for a missed transfer
      // (T15c) - the screen says so.
      res.json(await presence.setRingable(pool, req.user!.id, available));
      if (available) offerHoldTo(deps, req.user!.id);
    })
  );

  /**
   * The "Taking calls" switch, on or off, for the signed-in person. Refused
   * while automated calls are off: the switch is not shown, and nothing would
   * ring. Recorded only when it changed - `api/taking-calls.ts`.
   */
  router.post(
    '/taking-calls',
    asyncHandler(async (req, res) => {
      if (!deps.autoCalls) {
        throw new HttpError(503, 'auto_calls_off', 'Automated calls are not on on this server.');
      }
      const on = (req.body as { on?: unknown } | undefined)?.on;
      if (typeof on !== 'boolean') {
        throw new HttpError(400, 'invalid_on', 'on must be true or false.');
      }
      const user = req.user!;
      if (user.takingCalls !== on) {
        await deps.users.update(user.id, { takingCalls: { on, why: 'by_hand' } });
        await recordTakingCalls(deps, user.id, on, 'by_hand');
      }
      res.json({ takingCalls: on, takingCallsWhy: user.takingCalls !== on ? 'by_hand' : user.takingCallsWhy });
      if (on) offerHoldTo(deps, user.id);
    })
  );

  return router;
}
