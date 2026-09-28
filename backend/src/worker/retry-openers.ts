/**
 * Retries openers that never went out.
 *
 * Phase 3 task 27. `POLLER.md`, "Retrying a failed opener".
 *
 * **Why this exists.** When EZ Texting refuses or is unreachable, the poller
 * records the failure and moves on - the lead is in the database, scored
 * nothing, and is never contacted again. Nothing retried it. That is the worst
 * failure in the system: a lead the client paid for, sitting in a table,
 * silent, with no sign on any screen that anything went wrong. Deferred from
 * Week 2 (CLAUDE.md §10) into this task.
 *
 * **How a failed opener is recognised.** `worker/poller.ts` sets `expires_at`
 * only once the opener is actually accepted, so a conversation that is still
 * `open` with `expires_at IS NULL` never had one go out. That is the signature;
 * no new column is needed.
 *
 * **Backoff, and why it is spaced this widely.** EZ Texting being down is
 * usually minutes, not seconds, and a lead whose opener is an hour late is
 * still worth having - the alternative is losing them entirely. Retrying every
 * 60s would hammer an API that is already refusing us. Each wait counts from
 * the *last failed attempt*:
 *
 *   the poller's own attempt fails
 *   retry 1   5 minutes after that failure
 *   retry 2   30 minutes after the next
 *   retry 3   2 hours after the next
 *   retry 4   6 hours after the next, then give up
 *
 * Counted from the last failure, not from when the lead arrived - Jeel,
 * 2026-09-28, in review. Measured from arrival, a lead already older than its
 * schedule had every wait "already passed", so all four retries fired on four
 * consecutive ticks - four minutes - and a short outage burned them all. Each
 * failed attempt is a message row with its own `created_at`, set by the
 * database, which is the time to count from.
 *
 * **Never late by more than a day.** A lead whose opener has not gone out 24
 * hours after they arrived is not sent one. "You asked about health &
 * wellness" days after they asked reads as broken, and they have moved on -
 * and without this cap the first deploy would text every old lead whose opener
 * never went out, however old. Found in review, 2026-09-28.
 *
 * **Giving up is deliberate,** at the attempt limit or the age limit: by then
 * the failure is not transient, and an endless queue of doomed sends would bury
 * a real outage in noise. The lead keeps its failed message rows, so an agent
 * opening it sees the red "!" and can text by hand.
 */

import { pool } from '../db/pool';
import { isBlocked, recordFailedSend } from '../db/failed-sends';
import { renderMessage } from '../core/messages';
import { sendMessage } from '../integrations/ezt-client';
import { errText, log } from '../lib/log';

/**
 * Minutes to wait after the Nth failed attempt before trying again: after the
 * first failure (the poller's own attempt) wait 5, after the second 30, and so
 * on. One retry per entry.
 */
const WAIT_AFTER_FAILURE_MINUTES = [5, 30, 120, 360];

/** The poller's attempt plus one retry per wait. Past this, stop. */
const MAX_ATTEMPTS = WAIT_AFTER_FAILURE_MINUTES.length + 1;

/**
 * A lead older than this whose opener never went out is not sent one. The full
 * schedule finishes within about nine hours of the first failure, so this only
 * ever catches a lead that was never retried - the worker was down, or the
 * lead predates this code.
 */
const MAX_AGE_HOURS = 24;

/**
 * When the first attempt never happened at all - no failed row, e.g. the
 * `question_1` setting was missing - the first retry waits this long after the
 * lead arrived.
 */
const FIRST_ATTEMPT_AFTER_MINUTES = 1;

export interface RetryStats {
  /** Conversations found without an opener and due for another attempt. */
  due: number;
  sent: number;
  failed: number;
  /** Past the last attempt: left alone, counted so the number is visible. */
  abandoned: number;
  /** Older than MAX_AGE_HOURS with no opener: too late to send one. */
  tooOld: number;
  durationMs: number;
}

/**
 * How many openers we have already tried for this lead, and when the last one
 * failed.
 *
 * Read from the failed message rows `recordFailedSend` leaves, so no new column
 * is needed and both survive a restart. A blocked number records nothing -
 * that send was never attempted - so it never looks due here either.
 */
const FAILED_OPENERS = `
  FROM messages m
  WHERE m.lead_id = l.id
    AND m.direction = 'outbound'
    AND m.delivery_status = 'failed'
`;

/**
 * Runs one retry pass. Called from the worker loop beside the poll and the
 * expiry sweep, and like them it never throws: the caller logs and carries on.
 */
export async function retryFailedOpeners(): Promise<RetryStats> {
  const startedAt = Date.now();
  const stats: RetryStats = { due: 0, sent: 0, failed: 0, abandoned: 0, tooOld: 0, durationMs: 0 };

  const template = (
    await pool.query(`SELECT value FROM settings WHERE key = 'question_1'`)
  ).rows[0]?.value as string | undefined;

  if (!template) {
    log.error('sms.no_template', { key: 'question_1', retry: true });
    stats.durationMs = Date.now() - startedAt;
    return stats;
  }

  // Leads whose conversation is open and has no expiry: the opener never went
  // out. A blocked number is excluded - it is not a failure to retry, it is a
  // number we must not text. Ordered oldest first so the longest-waiting lead
  // is contacted first.
  const { rows } = await pool.query(
    `SELECT l.id, l.phone, l.first_name,
            (SELECT count(*)::int ${FAILED_OPENERS}) AS attempts,
            (SELECT max(m.created_at) ${FAILED_OPENERS}) AS last_failed_at,
            COALESCE(l.ezt_added_at, l.created_at) AS arrived_at
     FROM leads l
     JOIN conversations c ON c.lead_id = l.id
     WHERE c.status = 'open'
       AND c.expires_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM messages m
         WHERE m.lead_id = l.id AND m.direction = 'outbound'
           AND m.delivery_status IS DISTINCT FROM 'failed'
       )
       AND NOT EXISTS (
         SELECT 1 FROM dnc_list d WHERE d.phone = l.phone AND d.released_at IS NULL
       )
     ORDER BY arrived_at`
  );

  const now = Date.now();

  for (const row of rows) {
    const attempts: number = row.attempts;

    if (attempts >= MAX_ATTEMPTS) {
      stats.abandoned++;
      continue;
    }

    const arrivedAt = new Date(row.arrived_at).getTime();
    if (now - arrivedAt > MAX_AGE_HOURS * 3_600_000) {
      stats.tooOld++;
      continue;
    }

    // Due once the wait after the last failure has passed - or, if nothing has
    // been attempted yet, a minute after the lead arrived.
    const dueAt =
      attempts === 0
        ? arrivedAt + FIRST_ATTEMPT_AFTER_MINUTES * 60_000
        : new Date(row.last_failed_at).getTime() + WAIT_AFTER_FAILURE_MINUTES[attempts - 1] * 60_000;
    if (now < dueAt) continue;

    stats.due++;

    let rendered: string | null = null;
    try {
      const { text } = renderMessage(template, row.first_name);
      rendered = text;

      const result = await sendMessage([row.phone], text);

      await pool.query(
        `INSERT INTO messages (lead_id, direction, body, ezt_message_id)
         VALUES ($1, 'outbound', $2, $3)`,
        [row.id, text, result.id]
      );

      // The reply window starts now, not when the lead arrived: they are only
      // being asked at this point, so the seven days run from here.
      const days = (
        await pool.query(`SELECT value FROM settings WHERE key = 'expiry_days'`)
      ).rows[0]?.value;

      await pool.query(
        `UPDATE conversations
         SET expires_at = now() + ($2 || ' days')::interval, updated_at = now()
         WHERE lead_id = $1 AND status = 'open'`,
        [row.id, days ?? '7']
      );

      stats.sent++;
      log.info('sms.sent', {
        leadId: row.id,
        key: 'question_1',
        retry: attempts + 1,
        eztMessageId: result.id,
      });
    } catch (err) {
      stats.failed++;
      log.error('sms.failed', {
        leadId: row.id,
        key: 'question_1',
        retry: attempts + 1,
        err: errText(err),
      });
      // A number blocked between the poll and now is not a failure to retry.
      if (rendered && !isBlocked(err)) {
        await recordFailedSend(row.id, rendered);
        // Logged once, here, rather than every tick the lead stays abandoned.
        if (attempts + 1 >= MAX_ATTEMPTS) {
          log.warn('opener.gave_up', { leadId: row.id, attempts: attempts + 1 });
        }
      }
    }
  }

  stats.durationMs = Date.now() - startedAt;
  return stats;
}
