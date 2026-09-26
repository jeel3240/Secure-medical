/**
 * `GET /api/admin/overview?period=today|7d|30d` - Admin > Overview.
 *
 * Superadmin only. The per-agent table and the activity feed are the only place
 * one agent's work is visible to anyone but themselves - AUTH.md - which is why
 * the guard matters more here than on a read-only config page.
 *
 * Live system status is deliberately not here: it comes from the health
 * endpoint, so external monitoring reads exactly what the screen does.
 * ADMIN.md.
 */

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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../../db/admin-overview') as typeof import('../../db/admin-overview');

      res.json(await db.getOverview(parsePeriod(req.query.period)));
    })
  );

  return router;
}
