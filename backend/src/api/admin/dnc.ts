/**
 * `GET /api/admin/dnc?q=&page=&state=` - Admin > DNC list.
 *
 * Superadmin only, read-only. There is no POST and no DELETE, deliberately:
 * a number reaches the list through a disposition, a STOP or an EZ Texting
 * opt-out, and leaves it only by the lead texting START. ADMIN.md.
 *
 * Export CSV is in the design brief and not built: it hands a file of phone
 * numbers to a browser, which needs Jeel to say so first.
 */

import { Router } from 'express';
import { requireAuth, requirePasswordChanged, requireRole } from '../auth/middleware';
import type { AppDeps } from '../deps';
import { asyncHandler, HttpError } from '../http';
import type { DncQuery } from '../../db/admin-dnc';

const STATES: NonNullable<DncQuery['state']>[] = ['all', 'blocked', 'released'];

function parseState(raw: unknown): NonNullable<DncQuery['state']> {
  if (raw === undefined || raw === '') return 'all';
  if (typeof raw !== 'string' || !STATES.includes(raw as NonNullable<DncQuery['state']>)) {
    throw new HttpError(400, 'invalid_state', `state must be one of: ${STATES.join(', ')}.`);
  }
  return raw as NonNullable<DncQuery['state']>;
}

function parsePage(raw: unknown): number {
  if (raw === undefined || raw === '') return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new HttpError(400, 'invalid_page', 'page must be a whole number above 0.');
  }
  return n;
}

export function adminDncRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requirePasswordChanged, requireRole('superadmin'));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../../db/admin-dnc') as typeof import('../../db/admin-dnc');

      res.json(
        await db.listDnc({
          q: typeof req.query.q === 'string' ? req.query.q : undefined,
          page: parsePage(req.query.page),
          state: parseState(req.query.state),
        })
      );
    })
  );

  return router;
}
