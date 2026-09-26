/**
 * `GET /api/leads` - the agents' priority queue - and the claim/release pair
 * that decides who is working a lead.
 *
 * Open to any signed-in user: agents work from it, and a superadmin sees the
 * same thing. The superadmin-only list of every lead, replied or not, is
 * `GET /api/admin/leads` - see ADMIN-LEADS.md for why they are separate.
 */

import { Router } from 'express';
import { requireAuth, requirePasswordChanged } from './auth/middleware';
import type { AppDeps } from './deps';
import { asyncHandler, HttpError } from './http';

const TIERS = ['HOT', 'WARM', 'LOW'];
const SINCE_HOURS: Record<string, number> = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

/** Comma-separated and case-insensitive, so `tier=hot,warm` works. */
function parseTiers(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;

  const asked = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const unknown = asked.filter((t) => !TIERS.includes(t));
  if (unknown.length) {
    throw new HttpError(400, 'invalid_tier', `Tier must be one of: ${TIERS.join(', ')}.`);
  }
  return asked.length ? asked : undefined;
}

function parseSince(raw: unknown): Date | undefined {
  if (raw === undefined || raw === 'all') return undefined;
  const hours = typeof raw === 'string' ? SINCE_HOURS[raw] : undefined;
  if (!hours) {
    throw new HttpError(400, 'invalid_since', `Time window must be one of: ${Object.keys(SINCE_HOURS).join(', ')}, all.`);
  }
  return new Date(Date.now() - hours * 3600_000);
}

function parseLeadId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new HttpError(400, 'invalid_lead_id', 'Lead id must be a whole number above 0.');
  }
  return id;
}

/** Page size. Out of range is clamped by the query, not rejected. */
function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new HttpError(400, 'invalid_limit', 'Limit must be a whole number above 0.');
  }
  return n;
}

function parseList(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const values = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return values.length ? values : undefined;
}

export function queueRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requirePasswordChanged);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      // Loaded lazily: ../db/queue pulls in the pool, which pulls in config,
      // which exits the process when an env var is missing - that would break
      // the tests, which build the app without a full environment.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../db/queue') as typeof import('../db/queue');

      const result = await db.listQueue({
        tier: parseTiers(req.query.tier),
        source: parseList(req.query.source),
        since: parseSince(req.query.since),
        q: typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined,
        limit: parseLimit(req.query.limit),
      });

      res.json(result);
    })
  );

  router.post(
    '/:id/claim',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../db/claims') as typeof import('../db/claims');

      const result = await db.claimLead(parseLeadId(req.params.id), req.user!.id);

      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw new HttpError(404, 'not_found', 'No such lead.');
        }
        // 409 rather than 403: the caller did nothing wrong, someone was
        // simply first. The holder's name is what the queue shows.
        throw new HttpError(
          409,
          'already_claimed',
          `${result.heldBy.name} is already working this lead.`
        );
      }

      res.json({ claim: result.claim });
    })
  );

  router.post(
    '/:id/release',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../db/claims') as typeof import('../db/claims');

      const result = await db.releaseLead(
        parseLeadId(req.params.id),
        req.user!.id,
        req.user!.role === 'superadmin'
      );

      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw new HttpError(404, 'not_found', 'No such lead.');
        }
        throw new HttpError(
          403,
          'not_yours',
          `${result.heldBy.name} is working this lead. Only they or a superadmin can release it.`
        );
      }

      res.status(204).end();
    })
  );

  return router;
}
