/**
 * Twilio's webhooks for browser calling - Phase 4, TWILIO.md.
 *
 *   POST /api/webhooks/twilio/voice   how to connect a call the browser started
 *   POST /api/webhooks/twilio/status  how the lead's side of that call ended
 *
 * Unauthenticated, like the EZ Texting webhook, but unlike it Twilio signs
 * every request (X-Twilio-Signature), so anything unsigned or mis-signed is
 * refused before it reaches the database. With calling not set up, both routes
 * answer 404, as if they did not exist.
 *
 * Twilio posts form-encoded fields, not JSON, so this router parses its own
 * bodies.
 */

import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { agentIdFromIdentity, outcomeForStatus, REFUSAL_SPEECH, talkSeconds } from '../core/calls';
import { dialTwiml, isFromTwilio, refusalTwiml } from '../integrations/twilio';
import { errText, log } from '../lib/log';
import type { AppDeps } from './deps';
import { asyncHandler } from './http';

/**
 * Loaded inside the handlers: db/calls pulls in the pool, which pulls in
 * config, which exits the process when an env var is missing - that would kill
 * the route tests, which build the app without a full environment.
 */
function db() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../db/calls') as typeof import('../db/calls');
}

/** The raw archive's writer and the pool it writes on - loaded lazily, as above. */
function archive() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pool } = require('../db/pool') as typeof import('../db/pool');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { archiveWebhook } = require('../db/activity') as typeof import('../db/activity');
  return { pool, archiveWebhook };
}

const field = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === 'string' ? (body[key] as string) : '';

export function twilioWebhooksRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false, limit: '20kb' }));

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!deps.twilio) {
      res.status(404).json({ error: 'not_found', message: 'No such endpoint.' });
      return;
    }
    const signed = isFromTwilio(deps.twilio, {
      signature: req.header('X-Twilio-Signature'),
      path: req.originalUrl,
      params: req.body ?? {},
    });
    if (!signed) {
      // 403, not 404: Twilio itself never gets this, and a misconfigured
      // PUBLIC_URL - the likeliest cause - should be obvious in the logs.
      log.warn('twilio.webhook_rejected', { reason: 'bad_signature', path: req.path });
      res.status(403).json({ error: 'forbidden', message: 'Request is not signed by Twilio.' });
      return;
    }

    // Kept as it arrived, once it is known to be Twilio's - AUDIT.md. Not
    // allowed to stop the call: if the archive write fails the handler still
    // runs, and the failure is logged.
    archive()
      .archiveWebhook(archive().pool, { source: 'twilio', path: req.originalUrl, payload: req.body ?? {} })
      .catch((err: unknown) => log.error('twilio.archive_failed', { path: req.path, err: errText(err) }))
      .finally(next);
  });

  router.post(
    '/voice',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const callSid = field(body, 'CallSid');
      const agentId = agentIdFromIdentity(body.From);
      const leadId = Number(field(body, 'leadId'));
      const settings = deps.twilio!;

      res.type('text/xml');

      if (!callSid || agentId === null || !Number.isInteger(leadId) || leadId < 1) {
        log.warn('call.refused', { reason: 'bad_request', agentId, leadId: field(body, 'leadId') });
        res.send(refusalTwiml(REFUSAL_SPEECH.bad_request));
        return;
      }

      let result: Awaited<ReturnType<ReturnType<typeof db>['startCall']>>;
      try {
        result = await db().startCall({ callSid, leadId, agentId });
      } catch (err) {
        // The agent is listening: a sentence they understand, not Twilio's
        // "application error". Nothing was recorded, so a retry is clean.
        log.error('call.failed_to_start', { agentId, leadId, callSid, err: errText(err) });
        res.send(refusalTwiml(REFUSAL_SPEECH.bad_request));
        return;
      }
      if (!result.ok) {
        log.warn('call.refused', { reason: result.reason, agentId, leadId, callSid });
        res.send(refusalTwiml(REFUSAL_SPEECH[result.reason]));
        return;
      }

      log.info('call.started', { agentId, leadId, callSid });
      res.send(dialTwiml(settings, result.phone));
    })
  );

  router.post(
    '/status',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // The callback is on the lead's leg; our row is keyed by the browser's
      // leg, which Twilio sends as the parent.
      const callSid = field(body, 'ParentCallSid');
      const outcome = outcomeForStatus(body.CallStatus);

      if (callSid && outcome) {
        const durationSec = talkSeconds(outcome, body.CallDuration);
        const recorded = await db().finishCall({ callSid, outcome, durationSec });
        log.info('call.finished', { callSid, outcome, durationSec, recorded });
      }

      // Always 204: there is nothing for Twilio to retry, even for a status we
      // do not record.
      res.sendStatus(204);
    })
  );

  return router;
}
