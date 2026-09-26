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

export interface HealthCheck {
  name: string;
  status: HealthStatus;
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

  const [checkpointRows, webhookRows, expiryRows] = await Promise.all([
    pool.query(`SELECT value, updated_at FROM settings WHERE key = 'ezt_poll_checkpoint'`),
    pool.query(
      `SELECT max(COALESCE(received_at, created_at)) AS at FROM messages WHERE direction = 'inbound'`
    ),
    // Conversations past their expiry that the sweep has not closed. A handful
    // is normal between sweeps; a growing number means the worker is not
    // running the expiry pass.
    pool.query(
      `SELECT count(*)::int AS n FROM conversations
       WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at < now()`
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
    status: 'ok',
    message: null,
    detail: {
      lastInboundAt: iso(lastWebhookAt),
      ageSeconds: ageMs(lastWebhookAt) === null ? null : Math.round(ageMs(lastWebhookAt)! / 1000),
    },
  });

  const overdue: number = expiryRows.rows[0].n;
  checks.push({
    name: 'expiry',
    status: 'ok',
    message: null,
    detail: { conversationsPastExpiry: overdue },
  });

  // Without it sendMessage refuses every send - a configuration mistake that
  // otherwise shows up only as failed sends in the logs.
  const sendGroupSet = Boolean(config.ezt.sendGroup);
  checks.push({
    name: 'sending',
    status: sendGroupSet ? 'ok' : 'degraded',
    message: sendGroupSet ? null : 'EZT_SEND_GROUP is not set, so every outbound SMS is refused.',
    detail: { sendGroupSet },
  });

  return {
    status: checks.some((c) => c.status === 'degraded') ? 'degraded' : 'ok',
    checkedAt: new Date().toISOString(),
    checks,
  };
}
