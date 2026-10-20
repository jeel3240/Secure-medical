/**
 * Twilio's webhooks for browser calling - Phase 4, TWILIO.md.
 *
 *   POST /api/webhooks/twilio/voice           how to connect a call the browser started
 *   POST /api/webhooks/twilio/status          how a call ended - outgoing or incoming
 *   POST /api/webhooks/twilio/answered-by     who picked up a call we placed: a person or a machine
 *   POST /api/webhooks/twilio/recording       a call's recording is ready, for its transcript
 *   POST /api/webhooks/twilio/notice          the recording notice a lead we called hears first
 *   POST /api/webhooks/twilio/incoming        a lead is calling our number
 *   POST /api/webhooks/twilio/incoming/after  ringing the agent is over: what to say
 *
 * And the automated call's, T12 on (AUTO-CALLS.md) - each naming the call's
 * row, `?call=<id>`, in the address Twilio signs:
 *
 *   POST /api/webhooks/twilio/auto/answer     the lead picked up: the first question
 *   POST /api/webhooks/twilio/auto/gather     the lead answered a question, or said nothing (T13)
 *   POST /api/webhooks/twilio/auto/status     how the call ended
 *   POST /api/webhooks/twilio/auto/amd        who picked up: a person or a machine
 *   POST /api/webhooks/twilio/auto/claim      a person accepted the transfer (T15a)
 *   POST /api/webhooks/twilio/auto/after      the transfer's ringing is over (T15a)
 *
 * Unauthenticated, like the EZ Texting webhook, but unlike it Twilio signs
 * every request (X-Twilio-Signature), so anything unsigned or mis-signed is
 * refused before it reaches the database. With calling not set up, every
 * route answers 404, as if they did not exist - and the automated call's do
 * too while automated calls are off (`AUTO_CALLS`).
 *
 * Twilio posts form-encoded fields, not JSON, so this router parses its own
 * bodies.
 */

import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { matchSpokenChoice, type SpokenAnswer } from '../core/answers';
import { firstAsk, handleAnswer, OPT_OUT_KEY, planTransfer, type AskOrEnd, type CallResult } from '../core/call-script';
import {
  agentIdFromIdentity,
  answeredByFor,
  outcomeForStatus,
  REFUSAL_SPEECH,
  talkSeconds,
  tookByMachine,
} from '../core/calls';
import {
  autoCallTwiml,
  dialTwiml,
  emptyTwiml,
  hangupTwiml,
  isFromTwilio,
  missedCallTwiml,
  recordingNoticeTwiml,
  refusalTwiml,
  ringAgentTwiml,
  transferTwiml,
} from '../integrations/twilio';
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

function recordings() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../db/transcripts') as typeof import('../db/transcripts');
}

/** The texts a call leads to - after a missed call, and the link (T14). Loaded lazily, as above. */
function leadTexts() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../db/lead-texts') as typeof import('../db/lead-texts');
}

/** The automated call's row, and the script it says - loaded lazily, as above. */
function autoCalls() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rows = require('../db/auto-calls') as typeof import('../db/auto-calls');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const script = require('../db/call-script') as typeof import('../db/call-script');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const presence = require('../db/presence') as typeof import('../db/presence');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pool } = require('../db/pool') as typeof import('../db/pool');
  return {
    linkAutomatedCall: rows.linkAutomatedCall,
    keepAnswer: rows.keepAnswer,
    settleAutomatedCall: rows.settleAutomatedCall,
    transferContext: rows.transferContext,
    takeTransfer: rows.takeTransfer,
    missTransfer: rows.missTransfer,
    freePeople: () => presence.freePeople(pool),
    loadScript: () => script.loadActiveCallScript(pool),
    readMinConfidence: () => script.readMinConfidence(pool),
    readRingSeconds: () => script.readRingSeconds(pool),
  };
}

const field = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === 'string' ? (body[key] as string) : '';

/** A positive whole number from a webhook's address - the call's row, a step - or null. */
function autoCallId(raw: unknown): number | null {
  return typeof raw === 'string' && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

/** What the lead said or pressed, as Twilio's `<Gather>` reports it. */
function spokenAnswer(body: Record<string, unknown>): SpokenAnswer {
  const confidence = Number(field(body, 'Confidence'));
  return {
    heard: field(body, 'SpeechResult') || null,
    digits: field(body, 'Digits') || null,
    confidence: field(body, 'Confidence') !== '' && confidence >= 0 && confidence <= 1 ? confidence : null,
  };
}

export function twilioWebhooksRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false, limit: '20kb' }));

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!deps.twilio || (req.path.startsWith('/auto/') && !deps.autoCalls)) {
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
      const settings = deps.twilio!;
      const callSid = field(body, 'CallSid');
      const agentId = agentIdFromIdentity(body.From, settings.identityPrefix);
      const leadId = Number(field(body, 'leadId'));

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
      res.send(dialTwiml(settings, result.phone, callSid));
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
    if (missedLeadId !== null) await leadTexts().sendMissedCallText(missedLeadId);
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

  // Twilio's verdict on who picked up: a person, or the lead's voicemail. The
  // call it is about is named in the URL we gave Twilio, because this report
  // is made on the lead's leg and our row is keyed by the browser's.
  router.post(
    '/answered-by',
    asyncHandler(async (req, res) => {
      const callSid = typeof req.query.call === 'string' ? req.query.call : '';
      const answeredBy = answeredByFor(((req.body ?? {}) as Record<string, unknown>).AnsweredBy);

      if (callSid && answeredBy) {
        const recorded = await db().recordAnsweredBy({ callSid, answeredBy });
        log.info('call.answered_by', { callSid, answeredBy, recorded });
      }
      // 204 whatever happened: there is nothing here for Twilio to retry.
      res.sendStatus(204);
    })
  );

  // What a lead we called hears once they pick up, before the agent is
  // connected: that the call may be recorded. Twilio asks for it only on a
  // recorded call - the `<Number>` names this address only then.
  router.post('/notice', (_req, res) => {
    res.type('text/xml').send(recordingNoticeTwiml());
  });

  // A call's recording is ready. Kept, and its transcript put in line for the
  // worker - which talks to Twilio's transcription service, so this answers
  // at once. TWILIO.md, "Recordings and transcripts".
  router.post(
    '/recording',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const callSid = typeof req.query.call === 'string' ? req.query.call : '';
      const recordingSid = field(body, 'RecordingSid');

      if (callSid && recordingSid && field(body, 'RecordingStatus') === 'completed') {
        const durationSec = Math.max(0, Math.round(Number(field(body, 'RecordingDuration')) || 0));
        const channels = Math.max(1, Math.round(Number(field(body, 'RecordingChannels')) || 1));
        const saved = await recordings().saveRecording({ callSid, recordingSid, durationSec, channels });
        log.info('call.recorded', { callSid, recordingSid, durationSec, saved });
      }
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
        res.send(ringAgentTwiml(deps.twilio!, incoming.agentId, incoming.lead, callSid));
        return;
      }

      log.info('call.incoming', { callSid, missed: true, known: incoming.kind === 'missed' });
      if (incoming.kind === 'missed' && incoming.firstReport) {
        await leadTexts().sendMissedCallText(incoming.leadId);
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

  /**
   * The automated call's row for a webhook about it, linked to Twilio's id for
   * the call - saved now if Twilio's answer to placing it never reached us.
   * Null when the request names no row of ours, or another call's: then it is
   * not acted on.
   */
  const automatedCall = async (req: Request): Promise<{ callId: number; callSid: string } | null> => {
    const callId = autoCallId(req.query.call);
    const callSid = field((req.body ?? {}) as Record<string, unknown>, 'CallSid');
    if (callId === null || !callSid) return null;
    return (await autoCalls().linkAutomatedCall(callId, callSid)) ? { callId, callSid } : null;
  };

  // The lead picked up: a second's quiet, then the first question, listening
  // for the answer. Anything wrong and the call simply ends - the lead is
  // never left listening to Twilio's "application error".
  router.post(
    '/auto/answer',
    asyncHandler(async (req, res) => {
      res.type('text/xml');
      try {
        const call = await automatedCall(req);
        if (!call) {
          log.warn('auto_call.unknown_call', { path: req.path, callId: req.query.call });
          res.send(hangupTwiml());
          return;
        }
        const script = await autoCalls().loadScript();
        if (!script) {
          log.error('auto_call.no_script', { callId: call.callId });
          res.send(hangupTwiml());
          return;
        }
        const action = firstAsk(script);
        if (action.kind === 'end' && action.brokenScript) log.error('auto_call.broken_script', { callId: call.callId });
        log.info('auto_call.answered', { callId: call.callId, callSid: call.callSid });
        res.send(autoCallTwiml(deps.twilio!, { callId: call.callId, script, action, pauseFirst: true }));
      } catch (err) {
        log.error('auto_call.answer_failed', { callId: req.query.call, err: errText(err) });
        res.send(hangupTwiml());
      }
    })
  );

  // The lead answered a question, or said nothing - T13. What it means is
  // `matchSpokenChoice` (T7), what follows `handleAnswer` (T8, T13); this
  // keeps the answer, its result and any block (`keepAnswer`), and says what
  // comes next. The address names the step and which asking it was.
  router.post(
    '/auto/gather',
    asyncHandler(async (req, res) => {
      res.type('text/xml');
      /** The lead to text the link to, once Twilio has its answer. */
      let linkFor: number | null = null;
      try {
        const call = await automatedCall(req);
        const stepId = autoCallId(req.query.step);
        const attempt = req.query.try === '1' ? 1 : req.query.try === '2' ? 2 : null;
        if (!call || stepId === null || attempt === null) {
          log.warn('auto_call.unknown_call', { path: req.path, callId: req.query.call });
          res.send(hangupTwiml());
          return;
        }
        const ac = autoCalls();
        const [script, minConfidence] = await Promise.all([ac.loadScript(), ac.readMinConfidence()]);
        if (!script) {
          log.error('auto_call.no_script', { callId: call.callId });
          res.send(hangupTwiml());
          return;
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const spoken = spokenAnswer(body);
        const step = script.steps.find((s) => s.id === stepId) ?? null;
        const match = matchSpokenChoice(spoken, step?.choices ?? [], {
          optOutWords: script.optOutWords,
          optOutKey: OPT_OUT_KEY,
          minConfidence,
        });
        // Twilio asks here even after the lead hung up - `handleAnswer`.
        const hungUp = field(body, 'CallStatus') === 'completed';
        const outcome = handleAnswer(script, stepId, attempt, match, hungUp);

        // A "yes" to a transfer rings whoever is free right now (T15a).
        let next: AskOrEnd | null = null;
        let ring: { say: string[]; agentIds: number[]; lead: { id: number; name: string; phone: string } } | null = null;
        let result: CallResult | null = outcome.result;
        if (outcome.next?.kind === 'transfer') {
          const [context, free] = await Promise.all([ac.transferContext(call.callId), ac.freePeople()]);
          if (!context) throw new Error('the automated call has no row');
          const plan = planTransfer(script, outcome.next, { free, machine: tookByMachine(context.answeredBy) });
          if (plan.kind === 'ring') {
            ring = { say: plan.say, agentIds: plan.agentIds, lead: context.lead };
          } else {
            next = plan;
            result = plan.result;
          }
          log.info(ring ? 'auto_call.transfer' : 'auto_call.transfer_missed', {
            callId: call.callId,
            ...(ring ? { rung: ring.agentIds.length } : { reason: free.length === 0 ? 'nobody_free' : 'machine' }),
          });
        } else {
          next = outcome.next;
        }

        const { kept, leadId } = await ac.keepAnswer({
          callId: call.callId,
          step: step && { id: step.id, key: step.key },
          attempt,
          spoken,
          record: outcome.answer,
          result,
          blockNumber: outcome.blockNumber,
        });
        // What was heard stays in the database, never in the logs.
        log.info('auto_call.answer', {
          callId: call.callId,
          step: step?.key ?? stepId,
          attempt,
          meaning: match.result === 'choice' ? match.choice.label : match.result,
          confidence: spoken.confidence,
          hungUp,
          result,
          kept,
        });
        if (outcome.brokenScript) log.error('auto_call.broken_script', { callId: call.callId, step: stepId });
        // Texted once - only for the first copy of this request, `kept` - and
        // after Twilio has its answer, so the lead hears "check your SMS"
        // without waiting on EZ Texting (T14).
        if (outcome.sendLink && kept && leadId !== null) linkFor = leadId;

        if (ring) {
          res.send(
            transferTwiml(deps.twilio!, {
              callId: call.callId,
              callSid: call.callSid,
              script,
              say: ring.say,
              agentIds: ring.agentIds,
              lead: ring.lead,
              step: step?.heading ?? '',
              ringSeconds: await ac.readRingSeconds(),
            })
          );
        } else {
          res.send(next ? autoCallTwiml(deps.twilio!, { callId: call.callId, script, action: next }) : hangupTwiml());
        }
      } catch (err) {
        log.error('auto_call.gather_failed', { callId: req.query.call, err: errText(err) });
        res.send(hangupTwiml());
      }
      // Never throws: a text that could not be sent is logged, and the call's
      // answer is already saved as `link_sent`.
      if (linkFor !== null) await leadTexts().sendCallLinkText(linkFor);
    })
  );

  // How the call ended: saved as every call's end is (`finishCall`), on the
  // row this address names - and a script that never reached its own end is
  // given one: unanswered, or hung up (T13).
  router.post(
    '/auto/status',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const call = await automatedCall(req);
      if (call) {
        await recordEnd(call.callSid, body.CallStatus, body.CallDuration);
        await autoCalls().settleAutomatedCall(call.callId);
      } else {
        log.warn('auto_call.unknown_call', { path: req.path, callId: req.query.call });
      }
      res.sendStatus(204);
    })
  );

  // Who picked up: kept on the row, as for an agent's call. T18 acts on a
  // machine - leaves the voicemail message.
  router.post(
    '/auto/amd',
    asyncHandler(async (req, res) => {
      const answeredBy = answeredByFor(((req.body ?? {}) as Record<string, unknown>).AnsweredBy);
      const call = await automatedCall(req);
      if (call && answeredBy) {
        const recorded = await db().recordAnsweredBy({ callSid: call.callSid, answeredBy });
        log.info('call.answered_by', { callSid: call.callSid, answeredBy, recorded });
      }
      res.sendStatus(204);
    })
  );

  // A person accepted the transfer - Twilio runs this on their leg, before
  // they are connected (T15a). The lead becomes theirs (`takeTransfer`). The
  // leg is the person's: the automated call is its parent, and the person is
  // who it rang (`To`, our signed browser name). Anything wrong after they
  // accepted still connects them - the lead is waiting for a person.
  router.post(
    '/auto/claim',
    asyncHandler(async (req, res) => {
      res.type('text/xml');
      const body = (req.body ?? {}) as Record<string, unknown>;
      const callId = autoCallId(req.query.call);
      const parentSid = field(body, 'ParentCallSid');
      const agentId = agentIdFromIdentity(body.To, deps.twilio!.identityPrefix);
      if (callId === null || !parentSid || agentId === null) {
        log.warn('auto_call.unknown_call', { path: req.path, callId: req.query.call });
        res.send(hangupTwiml());
        return;
      }
      try {
        const ac = autoCalls();
        const taken = (await ac.linkAutomatedCall(callId, parentSid))
          ? await ac.takeTransfer(callId, agentId)
          : ({ ok: false, reason: 'not_found' } as const);
        if (!taken.ok) {
          log.warn('auto_call.transfer_refused', { callId, agentId, reason: taken.reason });
          res.send(hangupTwiml());
          return;
        }
        log.info('auto_call.transferred', { callId, agentId, leadId: taken.leadId, tookOverFrom: taken.tookOverFrom });
      } catch (err) {
        log.error('auto_call.claim_failed', { callId, agentId, err: errText(err) });
      }
      res.send(emptyTwiml());
    })
  );

  // The transfer's ringing is over (T15a). Someone took it and they talked:
  // nothing more to say. Nobody took it - or the lead hung up while it rang:
  // `transfer_missed`, so an agent calls them back, and the busy line if they
  // are still there.
  router.post(
    '/auto/after',
    asyncHandler(async (req, res) => {
      res.type('text/xml');
      const status = field((req.body ?? {}) as Record<string, unknown>, 'DialCallStatus');
      if (status === 'completed' || status === 'answered') {
        res.send(emptyTwiml());
        return;
      }
      try {
        const call = await automatedCall(req);
        if (!call) {
          log.warn('auto_call.unknown_call', { path: req.path, callId: req.query.call });
          res.send(hangupTwiml());
          return;
        }
        const ac = autoCalls();
        await ac.missTransfer(call.callId);
        log.info('auto_call.transfer_missed', { callId: call.callId, reason: 'not_taken', dialStatus: status });
        const script = await ac.loadScript();
        res.send(
          script
            ? autoCallTwiml(deps.twilio!, {
                callId: call.callId,
                script,
                action: { kind: 'end', say: [script.busyBody], result: 'transfer_missed' },
              })
            : hangupTwiml()
        );
      } catch (err) {
        log.error('auto_call.after_failed', { callId: req.query.call, err: errText(err) });
        res.send(hangupTwiml());
      }
    })
  );

  return router;
}
