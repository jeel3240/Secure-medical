/**
 * `GET /api/admin/config` - Admin > Configuration.
 *
 * Superadmin only, read-only. Returns the live message copy, scoring rules,
 * tier bands and the settings the state machine reads, so the screen shows what
 * the system is actually using rather than a copy kept in the frontend.
 *
 * There is no writer, deliberately: Jeel's decision of 2026-09-23. ADMIN.md.
 */

import { Router } from 'express';
import { requireAuth, requirePasswordChanged, requireRole } from '../auth/middleware';
import type { AppDeps } from '../deps';
import { asyncHandler } from '../http';

export function adminConfigRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requirePasswordChanged, requireRole('superadmin'));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      // Loaded lazily: ../../db/admin-config pulls in the pool, which pulls in
      // config, which exits the process when an env var is missing - that would
      // break the tests, which build the app without a full environment.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../../db/admin-config') as typeof import('../../db/admin-config');

      res.json(await db.getAdminConfig());
    })
  );

  return router;
}
