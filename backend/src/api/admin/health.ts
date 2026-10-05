/**
 * `GET /api/admin/health` - the deep health check.
 *
 * Superadmin only, per LOGGING.md. `GET /api/health` stays open and unchanged
 * for Caddy and container checks; this one reports the database round trip, the
 * last poll, the last inbound webhook, unswept expiries, whether sending is
 * configured, and whether calling is still wired to this server.
 *
 * **Consequence of the superadmin guard:** anything monitoring from outside has
 * to hold a session to read it, so an uptime service cannot poll this URL as it
 * stands. That is deliberate - the response says how the business is doing, not
 * just whether a process is up - but if external monitoring is wanted later it
 * needs a separate unauthenticated route returning less, rather than this guard
 * being dropped. Still open after Phase 4.
 */

import { Router } from 'express';
import { requireAuth, requirePasswordChanged, requireRole } from '../auth/middleware';
import type { AppDeps } from '../deps';
import { asyncHandler } from '../http';

export function adminHealthRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requirePasswordChanged, requireRole('superadmin'));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require('../../db/health') as typeof import('../../db/health');

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const twilioHealth = require('../../integrations/twilio-health') as typeof import('../../integrations/twilio-health');

      const health = await db.getHealth();

      // Calling is checked against Twilio, not the database, so it is added
      // here: are the TwiML App and the phone number still pointed at this
      // server. Skipped when the database is down - that report returns early
      // and says so on its own.
      if (health.checks.some((c) => c.name === 'database' && c.status === 'ok')) {
        const calling = await twilioHealth.getCallingCheck(deps.twilio);
        health.checks.push(calling);
        if (calling.status === 'degraded') health.status = 'degraded';
      }

      // 200 even when degraded: the report is the point, and a monitoring tool
      // that only reads the status code should still be able to fetch it. The
      // body's `status` field is the verdict.
      res.json(health);
    })
  );

  return router;
}
