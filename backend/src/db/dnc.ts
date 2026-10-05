/**
 * Blocking and releasing a number.
 *
 * Three things block a number and they must all write `dnc_list` the same way,
 * or a number blocked one way behaves differently from a number blocked
 * another:
 *
 *   - a STOP reply, or EZ Texting's own `optOut` flag - `api/webhooks.ts`
 *   - the poller finding a contact already opted out on EZ Texting's side -
 *     `worker/poller.ts` (through here since 2026-10-01; before that it had
 *     its own insert, which wrote no record)
 *   - an agent setting the `DNC` disposition - `db/dispositions.ts`
 *
 * These functions were `webhooks.ts` locals until task 8 needed the second
 * caller. Moved rather than copied: a compliance table with two insert
 * statements is a table that eventually holds two shapes of row.
 *
 * Only a row with `released_at IS NULL` blocks anything. The queue, the lead
 * card, Admin > Leads and `sendMessage` all check it that way.
 */

import { activityInsertSql } from './activity';

/** Anything with a `query` method: the pool, or a client inside a transaction. */
export interface Queryable {
  query: (q: string, v?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/** Why a number is blocked. Stored as `dnc_list.reason`. */
export const DNC_REASONS = {
  /** A STOP reply, or EZ Texting's optOut flag on one. */
  smsStop: 'sms_stop',
  /** The contact was already opted out on EZ Texting when the poller found it. */
  eztOptOut: 'ezt_opt_out',
  /** An agent chose the DNC disposition. */
  agentDisposition: 'agent_disposition',
} as const;

/** Why a block was lifted. Stored as `dnc_list.released_reason`. */
export const RELEASE_REASONS = {
  /** The lead texted START. */
  smsStart: 'sms_start',
} as const;

/**
 * Blocks the number, or re-blocks one that was released.
 *
 * No lead is required: `phone` is the table's only key, so a number can be
 * blocked before we ever hold a lead for it - which is the point when a partner
 * later delivers someone who has already opted out.
 *
 * A number that opted out, was released, and opts out again reuses its row -
 * the unique index on `phone` means there is only ever one. The block goes live
 * again and the release columns are cleared, so the row reads as currently
 * blocked with the newest reason.
 */
export async function blockNumber(
  client: Queryable,
  phone: string,
  reason: string,
  /** The agent who pressed DNC. Null when a STOP reply or EZ Texting did it. */
  actorId: number | null = null
): Promise<void> {
  // Re-blocking reuses the row, which overwrites when and why the number was
  // blocked before and that it was ever released. `previous` keeps that - the
  // activity log is the only place the earlier block survives. docs/AUDIT.md.
  await client.query(
    `WITH previous AS (
       SELECT reason, added_at AS "blockedAt", released_at AS "releasedAt",
              released_reason AS "releaseReason"
       FROM dnc_list WHERE phone = $1
     ),
     blocked AS (
       INSERT INTO dnc_list (phone, reason) VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE
       SET reason = EXCLUDED.reason, added_at = now(),
           released_at = NULL, released_reason = NULL
       RETURNING phone
     ),
     logged AS (
       ${activityInsertSql}
       SELECT $3, 'dnc.blocked', (SELECT id FROM leads WHERE phone = $1), NULL,
              jsonb_strip_nulls(jsonb_build_object(
                'phone', phone, 'reason', $2::text,
                'previous', (SELECT to_jsonb(previous) FROM previous)
              ))
       FROM blocked
     )
     SELECT 1 FROM blocked`,
    [phone, reason, actorId]
  );
}

/**
 * Lifts every live block on the number, keeping the row as the record.
 *
 * Every reason is released, including one an agent set - Jeel's decision,
 * 2026-09-22: someone who asks to be contacted again is asking whatever the
 * block was for. The dates stay on the row, so the history reads "blocked on
 * the 22nd, released on the 22nd".
 *
 * Returns how many rows were released, which is 0 when the number was not
 * blocked - a START from someone we never blocked changes nothing.
 */
export async function releaseNumber(
  client: Queryable,
  phone: string,
  reason: string = RELEASE_REASONS.smsStart,
  actorId: number | null = null
): Promise<number> {
  const { rowCount } = await client.query(
    `WITH released AS (
       UPDATE dnc_list
       SET released_at = now(), released_reason = $2
       WHERE phone = $1 AND released_at IS NULL
       RETURNING phone, reason, added_at
     ),
     logged AS (
       ${activityInsertSql}
       SELECT $3, 'dnc.released', (SELECT id FROM leads WHERE phone = $1), NULL,
              jsonb_build_object('phone', phone, 'releaseReason', $2::text,
                                 'blockReason', reason, 'blockedAt', added_at)
       FROM released
     )
     SELECT 1 FROM released`,
    [phone, reason, actorId]
  );
  return rowCount ?? 0;
}
