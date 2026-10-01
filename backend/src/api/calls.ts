/**
 * `GET /api/calls/config` and `POST /api/calls/token` - what the browser needs
 * to place a call. Phase 4, TWILIO.md.
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
import { log } from '../lib/log';

export function callsRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requirePasswordChanged);

  /** Whether calling is set up, and the number leads will see - for the Call button. */
  router.get('/config', (_req, res) => {
    res.json({ enabled: deps.twilio !== null, callerId: deps.twilio?.callerId ?? null });
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

  return router;
}
