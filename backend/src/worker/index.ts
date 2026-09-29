import '../config';
import { pool } from '../db/pool';
import { expireStaleConversations } from './expiry';
import { pollOnce } from './poller';
import { errText, log } from '../lib/log';
import { retryFailedOpeners } from './retry-openers';

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

    let waitMs = DEFAULT_POLL_INTERVAL_SECONDS * 1000;
    try {
      waitMs = await pollIntervalMs();
    } catch {
      // Fall back to the default rather than spinning if the DB is unreachable.
    }

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

log.info('worker.started');
loop();
