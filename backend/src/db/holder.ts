/**
 * Whether the caller holds a lead - the check every write on a lead runs first.
 *
 * Claiming was the only place the one-agent lock was enforced. Notes,
 * dispositions (DNC included), agent SMS, new callbacks and marking a reply
 * read were accepted from anyone signed in, on any lead, so the lock rested
 * entirely on the screen hiding the controls. An agent who opened a colleague's
 * lead by its address could text it or block its number. Jeel, 2026-09-28:
 * a lead is yours to act on only once you have picked it.
 *
 * Its own module rather than part of db/claims.ts so the route tests can mock
 * it without loading the pool, which loads config, which exits the process
 * when an env var is missing.
 *
 * AGENT-WORKSPACE.md, "Rules".
 */

import { pool } from './pool';

export type Holding =
  | { status: 'mine' }
  | { status: 'free' }
  | { status: 'other'; holder: string }
  | { status: 'not_found' };

/**
 * A claim by a deactivated agent counts as nobody's, matching the claim
 * endpoint and the queue: that lead can be picked, so it reads as free here
 * rather than as held by someone who can never release it.
 */
export async function holding(leadId: number, userId: number): Promise<Holding> {
  const { rows } = await pool.query<{ holder_id: number | null; holder_name: string | null }>(
    `SELECT u.id AS holder_id, u.name AS holder_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_to AND u.is_active
     WHERE l.id = $1`,
    [leadId]
  );

  if (rows.length === 0) return { status: 'not_found' };
  const { holder_id: holderId, holder_name: holderName } = rows[0];
  if (holderId === null) return { status: 'free' };
  if (holderId === userId) return { status: 'mine' };
  return { status: 'other', holder: holderName ?? 'Another agent' };
}
