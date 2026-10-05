/**
 * The agent workspace's routes on one lead, under `/api/leads/:id`: the card,
 * the timeline, and every write - a note, a callback, an agent SMS, a
 * disposition, marking a reply read. AGENT-WORKSPACE.md.
 *
 * Registered on the queue's router in `leads.ts`, so they share its sign-in
 * check; split out of that file on 2026-09-28, when it held ten routes.
 */

import type { Router } from 'express';
import { asyncHandler, HttpError } from './http';
import { parseLeadId } from './filters';
import { DISPOSITIONS, DNC_DISPOSITION, isDisposition } from '../core/dispositions';

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

/**
 * Refuses a write on a lead the caller has not picked - Jeel, 2026-09-28.
 *
 * Runs before anything that changes a lead: a note, a callback, an agent SMS,
 * a disposition, marking a reply read. Reading a lead needs no claim, so the
 * workspace can show one before it is picked; acting on it does. Without this
 * the lock was the screen's alone, and anyone signed in could text or block a
 * lead a colleague was working.
 *
 * Before the body is validated, deliberately: someone who may not act on the
 * lead learns nothing from how the request was shaped.
 */
async function requireHolding(leadId: number, userId: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('../db/holder') as typeof import('../db/holder');

  const held = await db.holding(leadId, userId);
  switch (held.status) {
    case 'mine':
      return;
    case 'not_found':
      throw new HttpError(404, 'not_found', 'No such lead.');
    case 'free':
      throw new HttpError(409, 'not_picked', 'Pick this lead before acting on it.');
    case 'other':
      // The same code the claim endpoint uses when someone was first.
      throw new HttpError(409, 'already_claimed', `${held.holder} is working this lead.`);
  }
}

export function leadWorkspaceRoutes(router: Router): void {
  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require('../db/notes') as typeof import('../db/notes');

      const leadId = parseLeadId(req.params.id);
      await requireHolding(leadId, req.user!.id);

      const result = await db.addNote(
        leadId,
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require('../db/callbacks') as typeof import('../db/callbacks');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const parse = require('./callbacks') as typeof import('./callbacks');

      const leadId = parseLeadId(req.params.id);
      await requireHolding(leadId, req.user!.id);

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
        leadId,
        agentId,
        parse.parseScheduledAt(body.scheduledAt),
        req.user!.id
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
    '/:id/messages',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require('../db/agent-sms') as typeof import('../db/agent-sms');

      const leadId = parseLeadId(req.params.id);
      await requireHolding(leadId, req.user!.id);

      // One segment. Longer costs a second segment on every send, and the
      // compose box counts down to the same number - DESIGN-PROMPT.md 3.
      const body = parseBody((req.body ?? {}).body, 'body', db.AGENT_SMS_LIMIT);

      const result = await db.sendAgentSms(leadId, req.user!.id, body);

      if (!result.ok) {
        if (result.reason === 'lead_not_found') {
          throw new HttpError(404, 'not_found', 'No such lead.');
        }
        if (result.reason === 'blocked') {
          // 409: the lead opted out, which is not something the agent can fix
          // by changing the request.
          throw new HttpError(
            409,
            'number_blocked',
            'This number is on the do-not-call list. Nothing was sent.'
          );
        }
        // Kept in the thread as a failed message, with a red "!" - the screen
        // shows that rather than an error box. Nothing reached the lead.
        throw new HttpError(502, 'send_failed', 'EZ Texting did not accept the message. It was not sent.');
      }

      res.status(201).json({ message: result.message });
    })
  );

  router.post(
    '/:id/dispositions',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require('../db/dispositions') as typeof import('../db/dispositions');

      const leadId = parseLeadId(req.params.id);
      await requireHolding(leadId, req.user!.id);

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

      const result = await db.setDisposition(leadId, req.user!.id, value);

      if (!result.ok) {
        throw new HttpError(404, 'not_found', 'No such lead.');
      }

      res.status(201).json({ disposition: result.disposition });
    })
  );

  router.post(
    '/:id/read',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require('../db/read-flag') as typeof import('../db/read-flag');

      // Reading a reply is handling it, and only the holder handles a lead. A
      // superadmin looking at someone else's lead must not be what makes it
      // leave the queue.
      const leadId = parseLeadId(req.params.id);
      await requireHolding(leadId, req.user!.id);

      const result = await db.markLeadRead(leadId, req.user!.id);
      if (!result.ok) {
        throw new HttpError(404, 'not_found', 'No such lead.');
      }

      res.status(204).end();
    })
  );
}
