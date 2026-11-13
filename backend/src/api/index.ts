import { KnowledgeError, loadKnowledge, type Knowledge } from '../ai/knowledge';
import { openAiModel } from '../ai/openai';
import { attachRelay, type Relay } from '../ai/relay';
import { pgRelayStore } from '../ai/relay-store';
import { readAutoCalls } from '../auto-calls-settings';
import { config } from '../config';
import { outcomeForStatus, talkSeconds } from '../core/calls';
import { recordActivity } from '../db/activity';
import { callsOnHold, settleAutomatedCall } from '../db/auto-calls';
import { readHoldMaxSeconds } from '../db/call-script';
import { finishCall } from '../db/calls';
import { endOffer, endStaleOffers, someoneComing, startOffer } from '../db/hold-offers';
import { pool } from '../db/pool';
import { pgUserStore } from '../db/users';
import { callEnd, recheckHold, sendToOffer } from '../integrations/twilio-calls';
import { createApp } from './app';
import { watchHolds } from './hold-watch';
import { log } from '../lib/log';
import { startupProblems } from './startup-checks';

const isProduction = process.env.NODE_ENV === 'production';

// Refuses to start on a production setting that would leave a hole -
// startup-checks.ts says which and why.
const problems = startupProblems({
  production: isProduction,
  jwtSecret: config.jwtSecret,
  webhookToken: config.ezt.webhookToken,
  twilio: config.twilio,
});
if (problems.length > 0) {
  const missing = config.twilio.status === 'incomplete' ? config.twilio.missing : undefined;
  for (const reason of problems) {
    log.error('api.refused_start', reason === 'twilio_incomplete' ? { reason, missing } : { reason });
  }
  process.exit(1);
}

// Seri's knowledge files - AI-AGENT.md section 5. A broken one must never
// reach a call, so it stops the start, whether or not the AI agent is on: the
// files are in the repo, so a broken one is a bug, found here on the first
// start rather than when she is switched on.
let knowledge: Knowledge;
try {
  knowledge = loadKnowledge();
} catch (err) {
  if (!(err instanceof KnowledgeError)) throw err;
  for (const problem of err.problems) {
    log.error('api.refused_start', { reason: 'ai_knowledge_invalid', problem });
  }
  process.exit(1);
}

// Locally a partial set only warns: calling stays off, everything else runs.
if (config.twilio.status === 'incomplete') {
  log.warn('calling.off', { reason: 'incomplete_settings', missing: config.twilio.missing });
}

// Automated calls: AUTO_CALLS=on, and calling set up - AUTO-CALLS.md. Either
// missing leaves them off, said once here rather than found out later.
const autoCallsSetting = readAutoCalls(process.env);
if (autoCallsSetting.unknown !== null) {
  log.warn('auto_calls.off', { reason: 'unknown_value', value: autoCallsSetting.unknown });
} else if (autoCallsSetting.on && config.twilio.status !== 'on') {
  log.warn('auto_calls.off', { reason: 'calling_off' });
}
const autoCalls = autoCallsSetting.on && config.twilio.status === 'on';

const app = createApp({
  users: pgUserStore,
  jwtSecret: config.jwtSecret,
  secureCookies: isProduction,
  twilio: config.twilio.status === 'on' ? config.twilio.settings : null,
  autoCalls,
  openAiKey: config.openai.apiKey,
  activity: { record: (entry) => recordActivity(pool, entry) },
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  log.info('api.started', {
    port,
    calling: config.twilio.status,
    autoCalls: autoCalls ? 'on' : 'off',
    knowledge: knowledge.version,
  });
});

// Seri's relay - the WebSocket Twilio opens when a call goes to her (A10,
// A11, AI-AGENT.md). Only with automated calls on, like their webhooks: she
// only ever takes an automated call. OpenAI is reached only when a call does.
const relay: Relay | null =
  autoCalls && config.twilio.status === 'on'
    ? attachRelay(server, {
        twilio: config.twilio.settings,
        knowledge,
        store: pgRelayStore(pool),
        model: openAiModel(config.openai.apiKey),
      })
    : null;

// A lead on hold is looked at every 30 seconds, not only when a track of hold
// music ends, and offered to whoever is free - AUTO-CALLS.md "The hold line".
// Only with automated calls on.
if (autoCalls && config.twilio.status === 'on') {
  const settings = config.twilio.settings;
  watchHolds({
    endStaleOffers,
    startOffer,
    sendToOffer: (offer) => sendToOffer(settings, offer.callSid, offer.callId, offer.offerId),
    endOffer,
    callsOnHold,
    someoneComing,
    readHoldMaxSeconds: () => readHoldMaxSeconds(pool),
    recheckHold: (callSid, callId) => recheckHold(settings, callSid, callId),
    // As `/auto/status` ends a call, from Twilio's own record of it.
    closeIfOver: async (callSid, callId) => {
      const end = await callEnd(settings, callSid);
      const outcome = end && outcomeForStatus(end.status);
      if (!end || !outcome) return false;
      await finishCall({ callSid, outcome, durationSec: talkSeconds(outcome, end.durationSec) });
      await settleAutomatedCall(callId);
      return true;
    },
  });
}

/**
 * Stopping - a deploy, `docker compose up -d`, or a restart: Docker sends
 * SIGTERM and waits 10 seconds. No new connections; each call with Seri has
 * its turns written and its connection closed with 1012, so Twilio keeps the
 * call and reconnects to the api that starts next - Caddy holds the reconnect
 * while it does (AI-AGENT.md section 2, "When the line drops"); then the
 * requests under way are let finish, two seconds at most.
 */
let stopping = false;
function stop(signal: string): void {
  if (stopping) return;
  stopping = true;
  log.info('api.stopping', { signal, seriCalls: relay?.liveCalls() ?? 0 });
  const exit = () => process.exit(0);
  setTimeout(exit, 4_000).unref();
  // Not listening first, so a reconnect waits at Caddy for the next api rather than reaching this one.
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  void (relay?.stop() ?? Promise.resolve())
    .then(() => Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 2_000).unref())]))
    .then(exit, exit);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
