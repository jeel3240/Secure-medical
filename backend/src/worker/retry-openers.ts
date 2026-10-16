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
 * **Which leads.** `db/openers-never-sent.ts`, which also explains how a
 * failed opener is recognised - shared since 2026-10-16 with the resend after
 * an outage (`worker/send-waiting-openers.ts`), which takes over a lead only
 * once this retry has given up on it (`retryGaveUp`).
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

import { findOpenersNeverSent } from '../db/openers-never-sent';
import { pool } from '../db/pool';
import { errText, log } from '../lib/log';
import { sendOpener } from './opener';

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
 * worker stopped between saving the lead and sending - the first retry waits
 * this long after the lead arrived.
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
 * Why this retry will never try a lead again, or null while it still will:
 * `abandoned` once the attempts are used up, `tooOld` once the lead is past the
 * age limit. A lead given up on is what the resend after an outage takes
 * (`worker/send-waiting-openers.ts`) - and only that, so the two never send to
 * the same lead.
 */
export function retryGaveUp(
  lead: { attempts: number; arrivedAt: Date },
  now: number
): 'abandoned' | 'tooOld' | null {
  if (lead.attempts >= MAX_ATTEMPTS) return 'abandoned';
  if (now - lead.arrivedAt.getTime() > MAX_AGE_HOURS * 3_600_000) return 'tooOld';
  return null;
}

/**
 * Runs one retry pass. Called from the worker loop beside the poll and the
 * expiry sweep, and like them it never throws: the caller logs and carries on.
 */
export async function retryFailedOpeners(): Promise<RetryStats> {
  const startedAt = Date.now();
  const stats: RetryStats = { due: 0, sent: 0, failed: 0, abandoned: 0, tooOld: 0, durationMs: 0 };

  const leads = await findOpenersNeverSent(pool);
  const now = Date.now();

  for (const lead of leads) {
    const { attempts } = lead;

    const gaveUp = retryGaveUp(lead, now);
    if (gaveUp) {
      stats[gaveUp]++;
      continue;
    }

    // Due once the wait after the last failure has passed - or, if nothing has
    // been attempted yet, a minute after the lead arrived.
    const dueAt =
      attempts === 0 || !lead.lastFailedAt
        ? lead.arrivedAt.getTime() + FIRST_ATTEMPT_AFTER_MINUTES * 60_000
        : lead.lastFailedAt.getTime() + WAIT_AFTER_FAILURE_MINUTES[attempts - 1] * 60_000;
    if (now < dueAt) continue;

    stats.due++;

    try {
      // Recorded around the send - db/outbound.ts - so a text that went out is
      // never retried because a write after it failed.
      const result = await sendOpener(
        { id: lead.leadId, phone: lead.phone, firstName: lead.firstName },
        lead.template
      );

      if (!result.sent) {
        stats.failed++;
        log.error('sms.failed', {
          leadId: lead.leadId,
          key: 'question_1',
          retry: attempts + 1,
          blocked: result.blocked,
          err: errText(result.err),
        });
        // Logged once, at the attempt that reaches the limit, rather than
        // every tick the lead stays abandoned. A blocked number records no
        // attempt, so it never reaches it.
        if (!result.blocked && attempts + 1 >= MAX_ATTEMPTS) {
          log.warn('opener.gave_up', { leadId: lead.leadId, attempts: attempts + 1 });
        }
        continue;
      }

      stats.sent++;
      log.info('sms.sent', {
        leadId: lead.leadId,
        key: 'question_1',
        retry: attempts + 1,
        eztMessageId: result.eztMessageId,
      });
    } catch (err) {
      // Before the send (the database refused the row - nothing went out, and
      // nothing is counted, so it is tried again next tick) or after it (the
      // reply window - the text went out and its row says so).
      stats.failed++;
      log.error('sms.failed', { leadId: lead.leadId, key: 'question_1', retry: attempts + 1, err: errText(err) });
    }
  }

  stats.durationMs = Date.now() - startedAt;
  return stats;
}
