/**
 * `GET /api/callbacks` and `PATCH /api/callbacks/:id` - My Callbacks, and
 * rescheduling or completing one.
 *
 * Creating a callback belongs to a lead, so it lives on the leads router as
 * `POST /api/leads/:id/callbacks`.
 */

import { Router } from 'express';
import { requireAuth, requirePasswordChanged } from './auth/middleware';
import type { AppDeps } from './deps';
import { asyncHandler, HttpError } from './http';
import type { CallbackWhen } from '../db/callbacks';

const WHEN: CallbackWhen[] = ['today', 'upcoming', 'overdue', 'all'];

export function parseWhen(raw: unknown): CallbackWhen {
  if (raw === undefined || raw === '') return 'today';
  if (typeof raw !== 'string' || !WHEN.includes(raw as CallbackWhen)) {
    throw new HttpError(400, 'invalid_when', `when must be one of: ${WHEN.join(', ')}.`);
  }
  return raw as CallbackWhen;
}

/** An ISO timestamp. Rejects anything Date cannot read, rather than storing an Invalid Date. */
export function parseScheduledAt(raw: unknown): Date {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new HttpError(400, 'invalid_scheduled_at', 'scheduledAt is required.');
  }
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw new HttpError(400, 'invalid_scheduled_at', 'scheduledAt must be an ISO timestamp.');
  }
  return at;
}

function parseId(raw: string, field: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new HttpError(400, `invalid_${field}`, `${field} must be a whole number above 0.`);
  }
  return id;
}

export function callbacksRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requirePasswordChanged);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../db/callbacks') as typeof import('../db/callbacks');

      // An agent sees only their own. A superadmin may ask for another's -
      // DESIGN-PROMPT.md 5 gives them an Agent filter - and defaults to
      // their own, which keeps the screen the same for both roles.
      const asked = req.query.agentId;
      if (asked !== undefined && req.user!.role !== 'superadmin') {
        throw new HttpError(403, 'forbidden', "Only a superadmin can view another agent's callbacks.");
      }

      const agentId = asked === undefined ? req.user!.id : parseId(String(asked), 'agentId');

      res.json(await db.listCallbacks({ agentId, when: parseWhen(req.query.when) }));
    })
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const db = require('../db/callbacks') as typeof import('../db/callbacks');

      const body = (req.body ?? {}) as { scheduledAt?: unknown; done?: unknown };

      if (body.scheduledAt === undefined && body.done === undefined) {
        throw new HttpError(400, 'nothing_to_change', 'Send scheduledAt, done, or both.');
      }
      if (body.done !== undefined && typeof body.done !== 'boolean') {
        throw new HttpError(400, 'invalid_done', 'done must be true or false.');
      }

      const result = await db.updateCallback(
        parseId(req.params.id, 'id'),
        req.user!.id,
        req.user!.role === 'superadmin',
        {
          scheduledAt: body.scheduledAt === undefined ? undefined : parseScheduledAt(body.scheduledAt),
          done: body.done as boolean | undefined,
        }
      );

      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw new HttpError(404, 'not_found', 'No such callback.');
        }
        throw new HttpError(
          403,
          'not_yours',
          `This callback belongs to ${result.ownerName}. Only they or a superadmin can change it.`
        );
      }

      res.json({ callback: result.callback });
    })
  );

  return router;
}
