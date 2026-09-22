/**
 * Expiring conversations that go quiet.
 *
 * A lead who never replies, or stops replying partway through, would otherwise
 * sit `open` forever and hold the one-open-conversation-per-lead slot. Marking
 * them `expired` closes the conversation, takes the lead out of the agents'
 * queue, and shows it under Expired on Admin > Leads.
 *
 * Nothing is sent to the lead. STATE-MACHINE.md, "Expiry", is the spec.
 */

import { pool } from '../db/pool';

const DEFAULT_EXPIRY_DAYS = 7;

export interface ExpirySweep {
  expired: number;
  durationMs: number;
}

async function readExpiryDays(): Promise<number> {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'expiry_days'`);
  const days = Number(rows[0]?.value);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_EXPIRY_DAYS;
}

/**
 * Marks every `open` conversation that is past its deadline as `expired`.
 *
 * Only `open` conversations are touched: `completed` and `review` are not
 * waiting on the lead, and `suppressed` must never change.
 *
 * `expires_at` is normally set by whatever was last sent. Conversations created
 * before the poller set it have none, so they fall back to `created_at` plus
 * the same window - otherwise they would never expire at all.
 */
export async function expireStaleConversations(): Promise<ExpirySweep> {
  const startedAt = Date.now();
  const days = await readExpiryDays();

  const { rowCount } = await pool.query(
    `UPDATE conversations
     SET status = 'expired', updated_at = now()
     WHERE status = 'open'
       AND COALESCE(expires_at, created_at + ($1 || ' days')::interval) <= now()`,
    [String(days)]
  );

  return { expired: rowCount ?? 0, durationMs: Date.now() - startedAt };
}
