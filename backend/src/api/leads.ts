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
import { DISPOSITIONS, DNC_DISPOSITION, isDisposition } from '../core/dispositions';

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

/**
 * Free text from an agent. Trimmed, required, and capped well above anything
 * anyone types on purpose - the limit is there so a runaway client cannot fill
 * a column, not to ration what an agent can say.
 */
function parseBody(raw: unknown, field = 'body', max = 5000): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new HttpError(400, 'invalid_body', `${field} is required.`);
  }
  const text = raw.trim();
  if (text.length > max) {
    throw new HttpError(400, 'body_too_long', `${field} must be ${max} characters or fewer.`);
  }
  return text;
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

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../db/lead-detail') as typeof import('../db/lead-detail');

      const lead = await db.getLeadDetail(parseLeadId(req.params.id));
      if (!lead) {
        throw new HttpError(404, 'not_found', 'No such lead.');
      }

      res.json({ lead });
    })
  );

  router.get(
    '/:id/timeline',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../db/timeline') as typeof import('../db/timeline');

      const entries = await db.getTimeline(parseLeadId(req.params.id));
      if (entries === null) {
        throw new HttpError(404, 'not_found', 'No such lead.');
      }

      res.json({ entries });
    })
  );

  router.post(
    '/:id/notes',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../db/notes') as typeof import('../db/notes');

      const result = await db.addNote(
        parseLeadId(req.params.id),
        req.user!.id,
        parseBody((req.body ?? {}).body)
      );

      if (!result.ok) {
        throw new HttpError(404, 'not_found', 'No such lead.');
      }

      res.status(201).json({ note: result.note });
    })
  );

  router.post(
    '/:id/callbacks',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../db/callbacks') as typeof import('../db/callbacks');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const parse = require('./callbacks') as typeof import('./callbacks');

      const body = (req.body ?? {}) as { scheduledAt?: unknown; agentId?: unknown };

      // Defaults to the caller. A superadmin may book one for another agent -
      // covering for someone off sick - and nobody else may.
      let agentId = req.user!.id;
      if (body.agentId !== undefined) {
        if (req.user!.role !== 'superadmin') {
          throw new HttpError(403, 'forbidden', 'Only a superadmin can assign a callback to another agent.');
        }
        const asked = Number(body.agentId);
        if (!Number.isInteger(asked) || asked < 1) {
          throw new HttpError(400, 'invalid_agent_id', 'agentId must be a whole number above 0.');
        }
        agentId = asked;
      }

      const result = await db.createCallback(
        parseLeadId(req.params.id),
        agentId,
        parse.parseScheduledAt(body.scheduledAt)
      );

      if (!result.ok) {
        throw result.reason === 'lead_not_found'
          ? new HttpError(404, 'not_found', 'No such lead.')
          : new HttpError(400, 'invalid_agent_id', 'No such active agent.');
      }

      res.status(201).json({ callback: result.callback });
    })
  );

  router.post(
    '/:id/dispositions',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../db/dispositions') as typeof import('../db/dispositions');

      const body = (req.body ?? {}) as { value?: unknown; confirmDnc?: unknown };

      const value = typeof body.value === 'string' ? body.value.trim().toLowerCase() : '';
      if (!isDisposition(value)) {
        throw new HttpError(
          400,
          'invalid_disposition',
          `Disposition must be one of: ${DISPOSITIONS.join(', ')}.`
        );
      }

      // DNC blocks the number everywhere and only a START lifts it, so the
      // caller has to say it meant it. DESIGN-PROMPT.md 3 puts a confirm dialog
      // in front of it; this is the same guard on the API, so a mis-typed
      // request cannot silently suppress a lead.
      if (value === DNC_DISPOSITION && body.confirmDnc !== true) {
        throw new HttpError(
          400,
          'confirm_required',
          'Setting DNC blocks this number for SMS and calls. Send confirmDnc: true to proceed.'
        );
      }

      const result = await db.setDisposition(parseLeadId(req.params.id), req.user!.id, value);

      if (!result.ok) {
        throw new HttpError(404, 'not_found', 'No such lead.');
      }

      res.status(201).json({ disposition: result.disposition });
    })
  );

  router.post(
    '/:id/read',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../db/read-flag') as typeof import('../db/read-flag');

      const result = await db.markLeadRead(parseLeadId(req.params.id));
      if (!result.ok) {
        throw new HttpError(404, 'not_found', 'No such lead.');
      }

      res.status(204).end();
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
