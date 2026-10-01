/**
 * Twilio's webhooks for browser calling - Phase 4, TWILIO.md.
 *
 *   POST /api/webhooks/twilio/voice           how to connect a call the browser started
 *   POST /api/webhooks/twilio/status          how a call ended - outgoing or incoming
 *   POST /api/webhooks/twilio/incoming        a lead is calling our number
 *   POST /api/webhooks/twilio/incoming/after  ringing the agent is over: what to say
 *
 * Unauthenticated, like the EZ Texting webhook, but unlike it Twilio signs
 * every request (X-Twilio-Signature), so anything unsigned or mis-signed is
 * refused before it reaches the database. With calling not set up, all four
 * routes answer 404, as if they did not exist.
 *
 * Twilio posts form-encoded fields, not JSON, so this router parses its own
 * bodies.
 */

import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { agentIdFromIdentity, outcomeForStatus, REFUSAL_SPEECH, talkSeconds } from '../core/calls';
import { dialTwiml, emptyTwiml, isFromTwilio, missedCallTwiml, refusalTwiml, ringAgentTwiml } from '../integrations/twilio';
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

function missedText() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../db/missed-call-text') as typeof import('../db/missed-call-text');
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

  /**
   * Saves how a call ended and, when that made it a missed call, texts the
   * lead that we will call back. Safe to call for every report of the same
   * call: only the first is recorded, and only that one sends the text.
   */
  const recordEnd = async (callSid: string, status: unknown, duration: unknown): Promise<void> => {
    const outcome = outcomeForStatus(status);
    if (!callSid || !outcome) return;
    const durationSec = talkSeconds(outcome, duration);
    const { recorded, missedLeadId } = await db().finishCall({ callSid, outcome, durationSec });
    log.info('call.finished', { callSid, outcome, durationSec, recorded, missed: missedLeadId !== null });
    if (missedLeadId !== null) await missedText().sendMissedCallText(missedLeadId);
  };

  router.post(
    '/status',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // The callback is on the far leg - the lead's for a call we placed, the
      // agent's browser for one we received; our row is keyed by the first
      // leg, which Twilio sends as the parent.
      await recordEnd(field(body, 'ParentCallSid'), body.CallStatus, body.CallDuration);

      // Always 204: there is nothing for Twilio to retry, even for a status we
      // do not record.
      res.sendStatus(204);
    })
  );

  router.post(
    '/incoming',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const callSid = field(body, 'CallSid');
      const fromPhone = field(body, 'From');
      res.type('text/xml');

      // Whatever goes wrong, the lead hears that we will call back rather than
      // Twilio's "application error".
      let incoming: Awaited<ReturnType<ReturnType<typeof db>['startIncomingCall']>>;
      try {
        incoming = await db().startIncomingCall({ callSid, fromPhone });
      } catch (err) {
        log.error('call.incoming_failed', { callSid, err: errText(err) });
        res.send(missedCallTwiml());
        return;
      }

      if (incoming.kind === 'ring') {
        log.info('call.incoming', { callSid, leadId: incoming.lead.id, agentId: incoming.agentId });
        res.send(ringAgentTwiml(deps.twilio!, incoming.agentId, incoming.lead));
        return;
      }

      log.info('call.incoming', { callSid, missed: true, known: incoming.kind === 'missed' });
      if (incoming.kind === 'missed' && incoming.firstReport) {
        await missedText().sendMissedCallText(incoming.leadId);
      }
      res.send(missedCallTwiml());
    })
  );

  // Twilio comes here when ringing the agent ends. If they talked, there is
  // nothing to add, and /status saves the call with its length. Otherwise the
  // lead is still on the line and hears that we will call back.
  //
  // The missed call is recorded here as well as by /status. /status fires
  // whoever ended it - including a lead who hung up, which never reaches here -
  // but it reports on the agent's leg, and an agent whose browser is closed
  // may have no leg to report on. Whichever arrives first records it.
  router.post(
    '/incoming/after',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const status = field(body, 'DialCallStatus');
      res.type('text/xml');

      if (status === 'completed' || status === 'answered') {
        res.send(emptyTwiml());
        return;
      }
      try {
        await recordEnd(field(body, 'CallSid'), status, 0);
      } catch (err) {
        // The lead is listening: they still hear the message.
        log.error('call.missed_not_recorded', { callSid: field(body, 'CallSid'), err: errText(err) });
      }
      res.send(missedCallTwiml());
    })
  );

  return router;
}
