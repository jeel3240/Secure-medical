import { config } from '../config';
import { readAutoCalls, readAutoCallTestNumbers } from '../auto-calls-settings';
import {
  autoCallsSince,
  closeUnplacedCalls,
  dialRoom,
  leadsToCall,
  recordAutoCallsSwitch,
  stillDue,
  withDialLock,
} from '../db/auto-dial';
import { readCallHours } from '../db/call-script';
import { pool } from '../db/pool';
import { dialDueLeads, worthLogging, type DialDeps, type DialLook } from './auto-calls';
import { expireStaleConversations } from './expiry';
import { placeAutoCall } from './place-auto-call';
import { pollOnce } from './poller';
import { errText, log } from '../lib/log';
import { retryFailedOpeners } from './retry-openers';
import { advanceTranscripts } from './transcripts';

// The same as migration 005 sets; used only if the setting is missing.
const DEFAULT_POLL_INTERVAL_SECONDS = 30;

// Re-read each tick so an admin changing the setting takes effect without a
// worker restart.
async function pollIntervalMs(): Promise<number> {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [
    'poll_interval_seconds',
  ]);
  const seconds = rows.length > 0 ? Number(rows[0].value) : DEFAULT_POLL_INTERVAL_SECONDS;
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_POLL_INTERVAL_SECONDS) * 1000;
}

/**
 * The robot placing its calls (T20, `worker/auto-calls.ts`) - only with
 * `AUTO_CALLS` on and calling set up; null otherwise. Outside production, only
 * the test numbers are ever looked at (`AUTO_CALL_TEST_NUMBERS`).
 */
function autoDialler(): DialDeps | null {
  if (!readAutoCalls(process.env).on || config.twilio.status !== 'on') return null;
  const settings = config.twilio.settings;
  const numbers = readAutoCallTestNumbers(process.env, process.env.NODE_ENV === 'production');
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
  };
}

const dialler = autoDialler();

/**
 * Why the robot stopped - a lead waited on hold too long to be real, Twilio
 * went silent, Twilio refused our calls, no script - logged once when it
 * starts and once when it ends,
 * not every half minute (T20 review). Waiting on hold is the robot working as
 * it should, so it is not an alarm.
 */
let stoppedFor: DialLook['stopped'] = null;
function noteStop(look: DialLook): void {
  const now = look.stopped === 'on_hold' ? null : look.stopped;
  if (now === stoppedFor) return;
  if (now === 'silent') log.error('auto_call.webhooks_silent', { calls: look.silent });
  else if (now === 'refused') log.error('auto_call.twilio_refusing', {});
  else if (now === 'no_script') log.error('auto_call.no_script', {});
  else log.info('auto_call.dialling_again', { after: stoppedFor });
  stoppedFor = now;
}

// Serialised on purpose: one poller instance, one cycle at a time, so the
// checkpoint can't be advanced by two overlapping runs.
async function loop(): Promise<void> {
  for (;;) {
    try {
      const stats = await pollOnce();
      log.info('poll.tick', {
        fetched: stats.fetched,
        inserted: stats.inserted,
        skipped: stats.skipped,
        suppressed: stats.suppressed,
        openers: stats.openersSent,
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
// Each switch-on starts afresh: leads that arrived while automated calls were
// off are never called (`recordAutoCallsSwitch`). Before the first look.
recordAutoCallsSwitch(dialler !== null)
  .catch((err) => log.error('auto_calls.switch_not_recorded', { err: errText(err) }))
  .finally(() => loop());
