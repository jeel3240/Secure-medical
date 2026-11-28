import { cachedProbe, fallbackStreak, openAiProbe, seriState } from '../ai/health';
import { readAiAgentOn } from '../ai/settings';
import { config } from '../config';
import { readAutoCalls, readAutoCallTestNumbers } from '../auto-calls-settings';
import {
  autoCallsSince,
  closeUnplacedCalls,
  dialRoom,
  leadsToCall,
  recordAutoCallsSwitch,
  REFUSED_PAUSE_MINUTES,
  stillDue,
  withDialLock,
} from '../db/auto-dial';
import { readCallHours } from '../db/call-script';
import { withTryLock } from '../db/locks';
import { pool } from '../db/pool';
import { DEFAULT_POLL_INTERVAL_SECONDS, pollIntervalSeconds } from '../db/sql';
import { dialDueLeads, stopChange, worthLogging, type DialDeps, type DialLook } from './auto-calls';
import { expireStaleConversations } from './expiry';
import { placeAutoCall } from './place-auto-call';
import { pollOnce } from './poller';
import { errText, log } from '../lib/log';
import { retryFailedOpeners } from './retry-openers';
import { advanceTranscripts } from './transcripts';

// Re-read each tick, so a migration changing the setting takes effect without
// a worker restart; the default, migration 005's, is in db/sql.ts.
async function pollIntervalMs(): Promise<number> {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', ['poll_interval_seconds']);
  return pollIntervalSeconds(rows[0]?.value) * 1000;
}

/**
 * The robot placing its calls (T20, `worker/auto-calls.ts`) - only with
 * `AUTO_CALLS` on and calling set up; null otherwise. Outside production, only
 * the test numbers are ever looked at (`AUTO_CALL_TEST_NUMBERS`). With Seri
 * switched on, she is asked about first (A17, `ai/health.ts`): the switch is
 * read on every look, as the API reads it on every call; OpenAI at most once a
 * minute; the pause after three fallbacks as long as Twilio's (T28).
 */
function autoDialler(): DialDeps | null {
  if (!readAutoCalls(process.env).on || config.twilio.status !== 'on') return null;
  const settings = config.twilio.settings;
  const numbers = readAutoCallTestNumbers(process.env, process.env.NODE_ENV === 'production');
  // A mistyped entry is left out - so nobody it meant is ever rung: said once, here (review M25, 2026-11-22).
  if (numbers.invalid > 0) log.warn('auto_calls.test_numbers_invalid', { count: numbers.invalid });
  const only = numbers.only === null ? null : [...numbers.only];
  return {
    closeUnplacedCalls,
    autoCallsSince,
    readCallHours: () => readCallHours(pool),
    dialRoom,
    leadsToCall: (opts) => leadsToCall({ ...opts, only }),
    stillDue: (opts) => stillDue({ ...opts, only }),
    placeAutoCall: (leadId) => placeAutoCall({ leadId, settings, numbers }),
    withDialLock,
    seriReady: seriState({
      on: () => readAiAgentOn(pool, config.openai.apiKey),
      paused: () => fallbackStreak(pool, REFUSED_PAUSE_MINUTES),
      probe: cachedProbe(openAiProbe(config.openai.apiKey)),
    }),
  };
}

const dialler = autoDialler();

/**
 * Why the robot stopped - a lead waited on hold too long to be real, Twilio
 * went silent, Twilio refused our calls, no script, OpenAI down or Seri's
 * calls falling back (A17) - logged once when it starts and once when it ends,
 * not every half minute (T20 review). Waiting on hold is the robot working as
 * it should, so it is not an alarm.
 */
let stoppedFor: DialLook['stopped'] = null;
function noteStop(look: DialLook): void {
  const change = stopChange(stoppedFor, look);
  if (!change) return;
  const { now } = change;
  if (now === 'silent') log.error('auto_call.webhooks_silent', { calls: look.silent });
  else if (now === 'refused') log.error('auto_call.twilio_refusing', {});
  else if (now === 'no_script') log.error('auto_call.no_script', {});
  else if (now === 'openai_down') log.error('ai_agent.openai_down', { err: look.aiError });
  else if (now === 'ai_fallbacks') log.error('ai_agent.fallbacks_paused', { minutes: REFUSED_PAUSE_MINUTES });
  else log.info('auto_call.dialling_again', { after: stoppedFor });
  stoppedFor = now;
}

/** The advisory lock that keeps the worker to one cycle at a time, however many run. */
const WORKER_LOCK = 'worker_cycle';

/**
 * One cycle: the poll, the expiry sweep, the opener retry, transcripts and the
 * robot's calls - each apart, so one failing never stops the rest.
 */
async function cycle(): Promise<void> {
  try {
    const stats = await pollOnce();
    log.info('poll.tick', {
      fetched: stats.fetched,
      inserted: stats.inserted,
      skipped: stats.skipped,
      suppressed: stats.suppressed,
      openers: stats.openersSent,
      failed: stats.failed,
      ms: stats.durationMs,
    });
  } catch (err) {
    // Checkpoint is left where it was, so the next tick retries this ground.
    log.error('poll.failed', { err: errText(err) });
  }

  // Separate from the poll, and after it, so a failure on either side does
  // not stop the other: expiring is local work that must keep happening even
  // while EZ Texting is unreachable.
  try {
    const sweep = await expireStaleConversations();
    if (sweep.expired > 0) {
      log.info('conversation.expired', { expired: sweep.expired, ms: sweep.durationMs });
    }
  } catch (err) {
    log.error('expiry.failed', { err: errText(err) });
  }

  // Separate again, for the same reason: retrying an opener must not be
  // skipped because the poll threw, and a failure here must not stop the
  // next poll. A lead whose opener never went out is the worst state in the
  // system - paid for, in the database, and silent.
  try {
    const retry = await retryFailedOpeners();
    // Only when something was due. A lead past its last attempt or its age
    // limit stays a candidate until its conversation expires - up to seven
    // days - and logging it every minute would bury real events. The moment
    // of giving up is logged once, as opener.gave_up, by the retry itself.
    if (retry.due > 0) {
      log.info('opener.retry', {
        due: retry.due,
        sent: retry.sent,
        failed: retry.failed,
        unconfirmed: retry.unconfirmed,
        abandoned: retry.abandoned,
        tooOld: retry.tooOld,
        ms: retry.durationMs,
      });
    }
  } catch (err) {
    log.error('opener.retry_failed', { err: errText(err) });
  }

  // Call transcripts - TWILIO.md, "Recordings and transcripts". Apart from
  // the rest for the same reason: Twilio being slow must not hold up leads.
  try {
    const t = await advanceTranscripts();
    if (t.requested + t.completed + t.failed > 0) log.info('transcript.tick', { ...t });
  } catch (err) {
    log.error('transcript.tick_failed', { err: errText(err) });
  }

  // The robot's calls - AUTO-CALLS.md "When a lead is called". Apart from
  // the rest, and last: a failure here never stops the poll, nor the poll's
  // the calls - though a slow poll delays them, in the same tick.
  if (dialler) {
    try {
      const look = await dialDueLeads(dialler);
      if (worthLogging(look)) log.info('auto_call.dial', { ...look });
      if (look.inside && !look.locked) noteStop(look);
    } catch (err) {
      log.error('auto_call.dial_failed', { err: errText(err) });
    }
  }
}

// Serialised on purpose: one cycle at a time, so the checkpoint can't be
// advanced by two overlapping runs - and, since 2026-11-22, one cycle at a time
// whatever runs it (review M14): a second worker on the same database, by
// mistake, polled and retried alongside the first, and sent a retried first
// question twice. A cycle another worker holds is skipped, said once.
async function loop(): Promise<void> {
  let skipping = false;
  for (;;) {
    try {
      const ran = await withTryLock(WORKER_LOCK, async () => {
        await cycle();
        return true;
      });
      if (ran === null && !skipping) log.warn('worker.another_running', {});
      skipping = ran === null;
    } catch (err) {
      // The database not answering for the lock: nothing in the cycle could work either. The next tick tries again.
      log.error('worker.cycle_failed', { err: errText(err) });
    }

    let waitMs = DEFAULT_POLL_INTERVAL_SECONDS * 1000;
    try {
      waitMs = await pollIntervalMs();
    } catch {
      // Fall back to the default rather than spinning if the DB is unreachable.
    }

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

log.info('worker.started', { autoCalls: dialler ? 'on' : 'off' });
// Each switch-on is recorded (`recordAutoCallsSwitch`): leads that arrive
// after it are called first, then those already waiting at the switch-on
// (T27, `leadsToCall`). Before the first look.
recordAutoCallsSwitch(dialler !== null)
  .catch((err) => log.error('auto_calls.switch_not_recorded', { err: errText(err) }))
  .finally(() => loop());
