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
 * 60s would hammer an API that is already refusing us.
 *
 *   attempt 1   ~1 minute after the failure
 *   attempt 2   ~5 minutes
 *   attempt 3   ~30 minutes
 *   attempt 4   ~2 hours
 *   attempt 5   ~6 hours, then give up
 *
 * **Giving up is deliberate.** After the last attempt the lead is left alone
 * rather than retried forever: by then the failure is not transient, and an
 * endless queue of doomed sends would bury a real outage in noise. The lead
 * keeps its failed message rows, so an agent opening it sees the red "!" and
 * can text by hand.
 */

import { pool } from '../db/pool';
import { isBlocked, recordFailedSend } from '../db/failed-sends';
import { renderMessage } from '../core/messages';
import { sendMessage } from '../integrations/ezt-client';
import { errText, log } from '../lib/log';

/**
 * Minutes to wait before each attempt, counted from when the lead arrived.
 * The length of this array is also the number of attempts.
 */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];

/** Don't chase a lead forever: past this, an opener is not coming. */
const GIVE_UP_AFTER = BACKOFF_MINUTES.length;

export interface RetryStats {
  /** Conversations found without an opener and due for another attempt. */
  due: number;
  sent: number;
  failed: number;
  /** Past the last attempt: left alone, counted so the number is visible. */
  abandoned: number;
  durationMs: number;
}

/**
 * How many openers we have already tried for this lead.
 *
 * Counted from the failed message rows `recordFailedSend` leaves, so no new
 * column is needed and the count survives a restart. A blocked number records
 * nothing - that send was never attempted - so it never looks due here either.
 */
const ATTEMPTS_SQL = `
  SELECT count(*)::int
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
  const stats: RetryStats = { due: 0, sent: 0, failed: 0, abandoned: 0, durationMs: 0 };

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
            (${ATTEMPTS_SQL}) AS attempts,
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

  for (const row of rows) {
    const attempts: number = row.attempts;

    if (attempts >= GIVE_UP_AFTER) {
      stats.abandoned++;
      continue;
    }

    // Due when enough time has passed since the lead arrived. Measured from
    // arrival rather than the last attempt because the failed rows carry no
    // attempt time of their own worth trusting across a restart.
    const waitMs = BACKOFF_MINUTES[attempts] * 60_000;
    const arrivedAt = new Date(row.arrived_at).getTime();
    if (Date.now() - arrivedAt < waitMs) continue;

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
      if (rendered && !isBlocked(err)) await recordFailedSend(row.id, rendered);
    }
  }

  stats.durationMs = Date.now() - startedAt;
  return stats;
}
