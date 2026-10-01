/**
 * Marking a lead read.
 *
 * `leads.has_unread_inbound` is set by the webhook whenever a reply arrives.
 * Its job is to bring a lead an agent needs to see back into the queue: an
 * expired conversation is otherwise closed, but a lead who texts after it
 * expires is showing interest, so the queue keeps them while the flag is set
 * (`db/queue.ts`, `c.status = 'expired' AND l.has_unread_inbound`).
 *
 * Nothing cleared it until now, so such a lead never left the queue however
 * many times an agent read the message. This is the other half.
 *
 * AGENT-WORKSPACE.md, "Rules".
 */

import { activityInsertSql } from './activity';
import { pool } from './pool';

export type MarkReadResult =
  /** `changed` is false when it was already read - the caller can stay quiet. */
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'not_found' };

/**
 * Clears the unread flag.
 *
 * Idempotent: marking an already-read lead read is a success, because the
 * caller wanted it read and it is. The `changed` flag says whether this call
 * was the one that did it, which is what a log line or a UI refresh keys on.
 *
 * Deliberately not scoped to the lead's holder. Reading is not claiming - a
 * superadmin looking at a lead an agent holds has still read it, and the flag
 * is about whether a human has seen the message, not about who owns the work.
 */
export async function markLeadRead(leadId: number, actorId: number | null = null): Promise<MarkReadResult> {
  // Clearing the flag leaves no trace of who read the reply or when, so the
  // statement records it - only when this call is the one that cleared it.
  const cleared = await pool.query(
    `WITH cleared AS (
       UPDATE leads
       SET has_unread_inbound = false, updated_at = now()
       WHERE id = $1 AND has_unread_inbound
       RETURNING id
     ),
     logged AS (
       ${activityInsertSql}
       SELECT $2, 'reply.read', id, NULL, '{}'::jsonb FROM cleared
     )
     SELECT id FROM cleared`,
    [leadId, actorId]
  );

  if (cleared.rowCount === 1) return { ok: true, changed: true };

  // Nothing updated: either it was already read, or there is no such lead.
  const { rowCount } = await pool.query(`SELECT 1 FROM leads WHERE id = $1`, [leadId]);
  return rowCount === 1 ? { ok: true, changed: false } : { ok: false, reason: 'not_found' };
}
