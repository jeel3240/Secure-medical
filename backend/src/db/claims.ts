/**
 * Claiming and releasing a lead.
 *
 * One agent works a lead at a time. Claiming sets `leads.assigned_to` and
 * `assigned_at`; releasing clears both. Claims never expire - SCHEMA.md says
 * why - so a superadmin can force one off.
 *
 * AGENT-WORKSPACE.md, "Rules", is the spec.
 */

import { pool } from './pool';

export interface Claim {
  leadId: number;
  agentId: number;
  agentName: string;
  claimedAt: string;
}

export type ClaimResult =
  | { ok: true; claim: Claim }
  /** Someone else holds it. `heldBy` is who, for the 409 message. */
  | { ok: false; reason: 'already_claimed'; heldBy: { id: number; name: string } }
  | { ok: false; reason: 'not_found' };

export type ReleaseResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' }
  /** Held by someone else and the caller is not a superadmin. */
  | { ok: false; reason: 'not_yours'; heldBy: { id: number; name: string } };

/**
 * Claims the lead for an agent.
 *
 * The UPDATE carries the whole rule in its WHERE clause, so two agents clicking
 * at the same moment cannot both win: the second finds the row no longer
 * unclaimed and updates nothing. Reading first and then writing would leave a
 * gap between the two where both look free.
 *
 * A claim held by a deactivated agent does not count - the queue already
 * ignores it, so the claim endpoint has to agree or a lead could look free and
 * refuse to be taken.
 *
 * Re-claiming a lead you already hold succeeds and leaves `assigned_at` alone,
 * because opening a lead twice is not a new claim.
 */
export async function claimLead(leadId: number, agentId: number): Promise<ClaimResult> {
  const claimed = await pool.query(
    `UPDATE leads l
     SET assigned_to = $2,
         assigned_at = COALESCE(
           CASE WHEN l.assigned_to = $2 THEN l.assigned_at END,
           now()
         ),
         updated_at = now()
     WHERE l.id = $1
       AND (
         l.assigned_to IS NULL
         OR l.assigned_to = $2
         OR NOT EXISTS (
           SELECT 1 FROM users u WHERE u.id = l.assigned_to AND u.is_active
         )
       )
     RETURNING l.assigned_at`,
    [leadId, agentId]
  );

  if (claimed.rowCount === 1) {
    const { rows } = await pool.query(`SELECT name FROM users WHERE id = $1`, [agentId]);
    return {
      ok: true,
      claim: {
        leadId,
        agentId,
        agentName: rows[0]?.name ?? '',
        claimedAt: claimed.rows[0].assigned_at.toISOString(),
      },
    };
  }

  // Nothing updated: either the lead is gone, or an active agent holds it.
  const { rows } = await pool.query(
    `SELECT l.assigned_to, u.id AS holder_id, u.name AS holder_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_to AND u.is_active
     WHERE l.id = $1`,
    [leadId]
  );

  if (rows.length === 0) return { ok: false, reason: 'not_found' };

  return {
    ok: false,
    reason: 'already_claimed',
    heldBy: { id: rows[0].holder_id, name: rows[0].holder_name },
  };
}

/**
 * Releases a claim and returns the lead to the queue.
 *
 * An agent may release only their own; a superadmin may release anyone's, which
 * is the answer to a claim that never expires. Releasing a lead nobody holds
 * succeeds: the caller wanted it free and it is.
 */
export async function releaseLead(
  leadId: number,
  agentId: number,
  isSuperadmin: boolean
): Promise<ReleaseResult> {
  const released = await pool.query(
    `UPDATE leads
     SET assigned_to = NULL, assigned_at = NULL, updated_at = now()
     WHERE id = $1
       AND ($3 OR assigned_to IS NULL OR assigned_to = $2)
     RETURNING id`,
    [leadId, agentId, isSuperadmin]
  );

  if (released.rowCount === 1) return { ok: true };

  const { rows } = await pool.query(
    `SELECT l.id, u.id AS holder_id, u.name AS holder_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_to
     WHERE l.id = $1`,
    [leadId]
  );

  if (rows.length === 0) return { ok: false, reason: 'not_found' };

  return {
    ok: false,
    reason: 'not_yours',
    heldBy: { id: rows[0].holder_id, name: rows[0].holder_name },
  };
}
