/**
 * The deep health check behind `GET /api/admin/health`.
 *
 * `GET /api/health` stays as it is - it proves the API process is alive, which
 * is all Caddy and the container check need. This one answers the question that
 * actually matters: is the whole system still doing its job. LOGGING.md,
 * "Health endpoint".
 *
 * **The worker has no HTTP server,** so its health is inferred from what it
 * writes. The honest signal is when the poll checkpoint was last *touched*, not
 * the value it holds: the value is the newest contact's `createdAt`, which
 * stands still on a quiet account even while the worker polls happily every
 * minute. `settings.updated_at` is the one that moves on every successful poll.
 *
 * **Both ways this system goes quiet are silences, not failures** - LOGGING.md.
 * Neither crashes anything, so this endpoint reports ages rather than just
 * values, and anything watching it should alert on staleness.
 */

import { pool } from './pool';
import { config } from '../config';

export type HealthStatus = 'ok' | 'degraded';

/**
 * `info` is for a check with no verdict - Incoming replies, where a quiet night
 * is not a failure. It used to report `ok`, and an OK that can never be
 * anything else says nothing (Jeel, 2026-09-28). It never makes the whole
 * report degraded.
 */
export type CheckStatus = HealthStatus | 'info';

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  /** Why it is degraded. Null when it is fine. */
  message: string | null;
  detail: Record<string, unknown>;
}

export interface Health {
  status: HealthStatus;
  checkedAt: string;
  checks: HealthCheck[];
}

/**
 * How long without a poll before the worker is assumed to be in trouble.
 *
 * Six times the default 60s interval: long enough that a slow EZ Texting page
 * or a restart does not raise a false alarm, short enough that a dead worker is
 * noticed within the same working hour.
 */
const POLL_STALE_MS = 6 * 60 * 1000;

/**
 * How long past its `expires_at` an open conversation may sit before the expiry
 * sweep counts as stuck. The worker sweeps on every poll, about once a minute,
 * so ten minutes is several missed sweeps rather than one slow one.
 */
const EXPIRY_GRACE = `interval '10 minutes'`;

const ageMs = (at: Date | null): number | null => (at ? Date.now() - at.getTime() : null);
const iso = (at: Date | null): string | null => at?.toISOString() ?? null;

export async function getHealth(): Promise<Health> {
  const checks: HealthCheck[] = [];

  // The round trip, timed. A database that answers slowly is the usual first
  // sign of trouble, and `SELECT 1` proves the pool can actually get a
  // connection rather than just that the config parses.
  const startedAt = Date.now();
  let databaseMs: number | null = null;
  try {
    await pool.query('SELECT 1');
    databaseMs = Date.now() - startedAt;
    checks.push({
      name: 'database',
      status: 'ok',
      message: null,
      detail: { roundTripMs: databaseMs },
    });
  } catch (err) {
    checks.push({
      name: 'database',
      status: 'degraded',
      message: err instanceof Error ? err.message : 'The database did not answer.',
      detail: { roundTripMs: null },
    });

    // Nothing below can run without it. Returning here rather than letting five
    // more queries fail one after another.
    return {
      status: 'degraded',
      checkedAt: new Date().toISOString(),
      checks,
    };
  }

  const [checkpointRows, webhookRows, expiryRows, sendRows] = await Promise.all([
    pool.query(`SELECT value, updated_at FROM settings WHERE key = 'ezt_poll_checkpoint'`),
    pool.query(
      `SELECT max(COALESCE(received_at, created_at)) AS at FROM messages WHERE direction = 'inbound'`
    ),
    // Conversations the sweep should have closed by now. One past its expiry
    // by less than the grace is normal between sweeps; one past it by more
    // means the sweep is not running.
    pool.query(
      `SELECT count(*)::int AS n FROM conversations
       WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at < now() - ${EXPIRY_GRACE}`
    ),
    // The newest send attempt of the last day, and how many failed. A refused
    // send is kept marked failed - db/failed-sends.ts - which is what makes
    // this check possible.
    pool.query(
      `SELECT
         (SELECT delivery_status FROM messages
          WHERE direction = 'outbound' AND created_at > now() - interval '1 day'
          ORDER BY created_at DESC, id DESC LIMIT 1) AS last_status,
         (SELECT max(created_at) FROM messages
          WHERE direction = 'outbound' AND delivery_status IS DISTINCT FROM 'failed') AS last_sent_at,
         (SELECT count(*)::int FROM messages
          WHERE direction = 'outbound' AND delivery_status = 'failed'
            AND created_at > now() - interval '1 day') AS failed_last_day`
    ),
  ]);

  // updated_at, not value: see the note at the top of this file.
  const lastPollAt: Date | null = checkpointRows.rows[0]?.updated_at ?? null;
  const lastPollAge = ageMs(lastPollAt);
  const pollStale = lastPollAge === null || lastPollAge > POLL_STALE_MS;

  checks.push({
    name: 'poller',
    status: pollStale ? 'degraded' : 'ok',
    message:
      lastPollAt === null
        ? 'The poller has never completed a poll. It may never have run.'
        : pollStale
          ? `The last poll was ${Math.round(lastPollAge! / 1000)}s ago. The worker may not be running.`
          : null,
    detail: {
      lastPollAt: iso(lastPollAt),
      ageSeconds: lastPollAge === null ? null : Math.round(lastPollAge / 1000),
      staleAfterSeconds: POLL_STALE_MS / 1000,
      // What the checkpoint holds, which is a different thing from when it was
      // written and is shown so the two are not confused.
      checkpointValue: checkpointRows.rows[0]?.value ?? null,
    },
  });

  // Not a failure on its own: leads reply when they reply, and a quiet night is
  // not a broken webhook. Reported without a verdict, for a human to read.
  const lastWebhookAt: Date | null = webhookRows.rows[0]?.at ?? null;
  checks.push({
    name: 'webhook',
    status: 'info',
    message: null,
    detail: {
      lastInboundAt: iso(lastWebhookAt),
      ageSeconds: ageMs(lastWebhookAt) === null ? null : Math.round(ageMs(lastWebhookAt)! / 1000),
    },
  });

  // It always said ok until 2026-09-28, even with conversations weeks overdue.
  const overdue: number = expiryRows.rows[0].n;
  checks.push({
    name: 'expiry',
    status: overdue > 0 ? 'degraded' : 'ok',
    message:
      overdue > 0
        ? `${overdue} conversation(s) are past their reply window and still open. The expiry sweep may not be running.`
        : null,
    detail: { conversationsPastExpiry: overdue },
  });

  // Two ways texts stop going out: sending is switched off
  // (EZT_SEND_GROUP unset, so sendMessage refuses everything), or EZ Texting is
  // refusing what we send. The second is judged by the newest attempt of the
  // last day - it said ok for both until 2026-09-28, checking only the first.
  const sendGroupSet = Boolean(config.ezt.sendGroup);
  const send = sendRows.rows[0];
  const lastFailed = send.last_status === 'failed';
  checks.push({
    name: 'sending',
    status: !sendGroupSet || lastFailed ? 'degraded' : 'ok',
    message: !sendGroupSet
      ? 'EZT_SEND_GROUP is not set, so every outbound SMS is refused.'
      : lastFailed
        ? 'The last text was refused by EZ Texting.'
        : null,
    detail: {
      sendGroupSet,
      lastSentAt: iso(send.last_sent_at ?? null),
      failedLastDay: send.failed_last_day,
    },
  });

  return {
    status: checks.some((c) => c.status === 'degraded') ? 'degraded' : 'ok',
    checkedAt: new Date().toISOString(),
    checks,
  };
}
