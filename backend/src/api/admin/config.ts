/**
 * `GET /api/admin/config` - Admin > Configuration.
 *
 * Superadmin only. Returns the live message copy, scoring rules, tier bands
 * and the settings the state machine reads, the automated call's script and
 * settings (T24), and Seri's switch, so the screen shows what the system is
 * actually using rather than a copy kept in the frontend.
 *
 * Read-only - Jeel's decision of 2026-09-23, ADMIN.md - with one exception,
 * his of 2026-11-24: `POST /api/admin/config/ai-agent`, Seri's switch. It
 * changes nothing she says, only whether the robot's calls go to her, and a
 * button reaches it faster than a command on the server when she must be
 * stopped.
 */

import { Router } from 'express';
import { requireAuth, requirePasswordChanged, requireRole } from '../auth/middleware';
import type { AppDeps } from '../deps';
import { asyncHandler, HttpError } from '../http';
import { log } from '../../lib/log';

export function adminConfigRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requirePasswordChanged, requireRole('superadmin'));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      // Loaded lazily: ../../db/admin-config pulls in the pool, which pulls in
      // config, which exits the process when an env var is missing - that would
      // break the tests, which build the app without a full environment.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require('../../db/admin-config') as typeof import('../../db/admin-config');

      // What only the api knows about calls - AUTO-CALLS.md, T24.
      res.json(
        await db.getAdminConfig({
          autoCalls: deps.autoCalls,
          callbackNumber: deps.twilio?.callerId ?? null,
          recorded: Boolean(deps.twilio?.transcriptionServiceSid),
          openAiKeySet: Boolean(deps.openAiKey?.trim()),
        })
      );
    })
  );

  // Seri's switch, as the command sets it (`cli/ai-agent.ts`): on is refused
  // without the key, the change is one activity-log row - by this superadmin -
  // and the next robot call follows it, no restart. AI-AGENT.md section 7.
  router.post(
    '/ai-agent',
    asyncHandler(async (req, res) => {
      const on = (req.body ?? {}).on;
      if (typeof on !== 'boolean') throw new HttpError(400, 'invalid_body', 'Send { "on": true } or { "on": false }.');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ai = require('../../ai/settings') as typeof import('../../ai/settings');
      const to = on ? 'on' : 'off';
      if (ai.switchRefusal(to, deps.openAiKey ?? '') === 'no_key') {
        throw new HttpError(409, 'no_key', 'OPENAI_API_KEY is not set on the server, so Seri cannot be switched on.');
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { pool } = require('../../db/pool') as typeof import('../../db/pool');
      const result = await ai.switchAiAgent(pool, to, { via: 'website', userId: req.user!.id });
      log.info('ai_agent.switched', { to, changed: result.changed, via: 'website', userId: req.user!.id });
      res.json({ on, changed: result.changed });
    })
  );

  return router;
}
