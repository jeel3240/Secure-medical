import { Router } from 'express';
import { requireAuth, requirePasswordChanged, requireRole } from '../auth/middleware';
import type { AppDeps } from '../deps';
import { asyncHandler } from '../http';
import type { LeadStatus } from '../../db/leads';

const STATUSES: LeadStatus[] = [
  'awaiting_reply',
  'in_progress',
  'completed',
  'needs_review',
  'opted_out',
  'expired',
];

const SINCE_HOURS: Record<string, number> = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

function parseStatus(raw: unknown): LeadStatus | 'all' {
  return typeof raw === 'string' && STATUSES.includes(raw as LeadStatus) ? (raw as LeadStatus) : 'all';
}

function parseSince(raw: unknown): Date | undefined {
  const hours = typeof raw === 'string' ? SINCE_HOURS[raw] : undefined;
  return hours ? new Date(Date.now() - hours * 3600_000) : undefined;
}

function parseSource(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const values = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return values.length ? values : undefined;
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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../../db/leads') as typeof import('../../db/leads');

      const result = await db.listAdminLeads({
        status: parseStatus(req.query.status),
        source: parseSource(req.query.source),
        since: parseSince(req.query.since),
        q: typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined,
        page: Number(req.query.page) || 1,
      });

      const [sources, poll] = await Promise.all([db.listLeadSources(), db.lastPollAt()]);
      res.json({ ...result, sources, poll });
    })
  );

  return router;
}
