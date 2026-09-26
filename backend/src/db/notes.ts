/**
 * Agent notes on a lead.
 *
 * Append-only: a note is a record of what an agent thought at a moment, and the
 * timeline shows it in sequence. Nothing edits or deletes one - `notes` has no
 * `updated_at`, which SCHEMA.md calls a deliberate choice rather than an
 * oversight.
 *
 * AGENT-WORKSPACE.md, "Endpoints".
 */

import { pool } from './pool';

export interface Note {
  id: number;
  leadId: number;
  author: string;
  body: string;
  createdAt: string;
}

export type AddNoteResult = { ok: true; note: Note } | { ok: false; reason: 'not_found' };

/**
 * Writes a note against a lead.
 *
 * The author is the signed-in agent, taken from the session by the route and
 * never from the request body. Deliberately not restricted to the lead's
 * holder: a superadmin reviewing a lead an agent is working may still record
 * what they saw, and a note is evidence rather than ownership.
 */
export async function addNote(leadId: number, agentId: number, body: string): Promise<AddNoteResult> {
  // The foreign key would reject a bad lead id anyway, but as a constraint
  // violation rather than something the route can turn into a clean 404.
  const lead = await pool.query(`SELECT 1 FROM leads WHERE id = $1`, [leadId]);
  if (lead.rowCount === 0) return { ok: false, reason: 'not_found' };

  const { rows } = await pool.query(
    `INSERT INTO notes (lead_id, agent_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, created_at`,
    [leadId, agentId, body]
  );

  const { rows: author } = await pool.query(`SELECT name FROM users WHERE id = $1`, [agentId]);

  return {
    ok: true,
    note: {
      id: rows[0].id,
      leadId,
      author: author[0]?.name ?? '',
      body,
      createdAt: rows[0].created_at.toISOString(),
    },
  };
}
