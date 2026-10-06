import { Router } from 'express';
import { requireAuth, requirePasswordChanged, requireRole } from '../auth/middleware';
import type { AppDeps } from '../deps';
import { asyncHandler, HttpError } from '../http';
import { parseList, parseSince } from '../filters';
import type { LeadStatus } from '../../db/leads';

const STATUSES: LeadStatus[] = [
  'awaiting_reply',
  'offers',
  'answering',
  'ready',
  'working',
  'closed',
  'needs_review',
  'opted_out',
  'expired',
];

/** Absent or `all` is every status; anything else must be one of them - a 400 otherwise, like every other filter. */
/**
 * `?page=`: a whole number from 1, in a range no table will reach. Absent is
 * the first page. It goes into the statement as an offset, so anything else -
 * `2.5`, `1e30` - is refused here rather than turned into an error there.
 */
const MAX_PAGE = 100_000;

function parsePage(raw: unknown): number {
  if (raw === undefined || raw === '') return 1;
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new HttpError(400, 'invalid_page', 'Page must be a whole number from 1.');
  }
  return page;
}

function parseStatus(raw: unknown): LeadStatus | 'all' {
  if (raw === undefined || raw === '' || raw === 'all') return 'all';
  if (typeof raw !== 'string' || !STATUSES.includes(raw as LeadStatus)) {
    throw new HttpError(400, 'invalid_status', `status must be one of: ${STATUSES.join(', ')}, all.`);
  }
  return raw as LeadStatus;
}

/**
 * Admin > Leads: every lead the poller has pulled in, replied or not. The agent
 * queue deliberately shows only responders; this is the superadmin's view of
 * where leads drop off. Read-only.
 *
 * Loaded lazily because ../../db/leads pulls in the pool, which pulls in config,
 * which exits the process when an env var is missing - that would break the
 * tests, which build the app without a full environment.
 */
export function adminLeadsRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requirePasswordChanged, requireRole('superadmin'));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require('../../db/leads') as typeof import('../../db/leads');

      const result = await db.listAdminLeads({
        status: parseStatus(req.query.status),
        source: parseList(req.query.source),
        since: parseSince(req.query.since),
        q: typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined,
        page: parsePage(req.query.page),
      });

      const [sources, poll] = await Promise.all([db.listLeadSources(), db.lastPollAt()]);
      res.json({ ...result, sources, poll });
    })
  );

  return router;
}
