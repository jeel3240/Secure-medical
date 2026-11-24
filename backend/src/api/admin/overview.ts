/**
 * `GET /api/admin/overview?period=today|7d|30d` - Admin > Overview.
 *
 * Superadmin only. The per-agent table and the activity feed are the only view
 * of agents' work across leads - one lead's own history is on its timeline,
 * open to everyone - AUTH.md - which is why the guard matters more here than on
 * a read-only config page.
 *
 * Live system status is deliberately not here: it comes from the health
 * endpoint, so the screen and the health check read the same thing - which
 * only a superadmin can reach, nothing outside (README, "Known limits").
 * ADMIN.md.
 */

import { parseTimeZone } from '../filters';
import { Router } from 'express';
import { requireAuth, requirePasswordChanged, requireRole } from '../auth/middleware';
import type { AppDeps } from '../deps';
import { asyncHandler, HttpError } from '../http';
import type { OverviewPeriod } from '../../db/admin-overview';

const PERIODS: OverviewPeriod[] = ['today', '7d', '30d'];

export function parsePeriod(raw: unknown): OverviewPeriod {
  if (raw === undefined || raw === '') return 'today';
  if (typeof raw !== 'string' || !PERIODS.includes(raw as OverviewPeriod)) {
    throw new HttpError(400, 'invalid_period', `period must be one of: ${PERIODS.join(', ')}.`);
  }
  return raw as OverviewPeriod;
}

export function adminOverviewRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requirePasswordChanged, requireRole('superadmin'));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require('../../db/admin-overview') as typeof import('../../db/admin-overview');

      res.json(await db.getOverview(parsePeriod(req.query.period), parseTimeZone(req.query.tz)));
    })
  );

  return router;
}
