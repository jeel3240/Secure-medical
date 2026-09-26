/**
 * Setting a disposition - what the agent concluded about a lead - and the DNC
 * path that blocks the number.
 *
 * AGENT-WORKSPACE.md, "Dispositions"; DESIGN-PROMPT.md section 3, right column.
 */

import { pool } from './pool';
import { blockNumber, DNC_REASONS } from './dnc';
import { DNC_DISPOSITION, type Disposition } from '../core/dispositions';

export interface DispositionRow {
  id: number;
  leadId: number;
  agentId: number;
  agentName: string | null;
  value: Disposition;
  createdAt: string;
  /** True when this disposition blocked the number. Only ever true for `dnc`. */
  blockedNumber: boolean;
}

export type SetDispositionResult =
  | { ok: true; disposition: DispositionRow }
  | { ok: false; reason: 'lead_not_found' };

/**
 * Records the disposition, and blocks the number when it is `dnc`.
 *
 * **Append-only, like notes.** Nothing updates or deletes a disposition; an
 * agent who changes their mind adds another and the newest wins wherever one
 * value is needed. The timeline shows the sequence, which is the point: a lead
 * dispositioned "no answer" three times and then "interested" is a different
 * story from one dispositioned "interested" once.
 *
 * **The DNC path is one transaction.** The row and the block commit together,
 * or neither does. Writing the disposition first and blocking after would leave
 * a lead recorded as do-not-call whom we would still text, which is the failure
 * that actually matters here.
 *
 * **The block is the same row a STOP reply writes** - `db/dnc.ts` - so a number
 * blocked by an agent behaves exactly like one blocked by a STOP: it leaves the
 * queue, `sendMessage` refuses it, and a later START releases it. Jeel's
 * decision of 2026-09-22 stands: START releases an agent's block too.
 *
 * The reason is recorded as `agent_disposition`, so the DNC screen can tell an
 * agent's decision from a lead's own opt-out.
 */
export async function setDisposition(
  leadId: number,
  agentId: number,
  value: Disposition
): Promise<SetDispositionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Locked, so the phone cannot change under the block between reading it
    // and writing dnc_list. Also gives the clean 404 for an unknown lead.
    const lead = await client.query('SELECT id, phone FROM leads WHERE id = $1 FOR UPDATE', [leadId]);
    if (!lead.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'lead_not_found' };
    }

    const { rows } = await client.query(
      `INSERT INTO dispositions (lead_id, agent_id, value)
       VALUES ($1, $2, $3)
       RETURNING id, lead_id, agent_id, value, created_at`,
      [leadId, agentId, value]
    );

    const blockedNumber = value === DNC_DISPOSITION;
    if (blockedNumber) {
      await blockNumber(client, lead.rows[0].phone, DNC_REASONS.agentDisposition);
    }

    // The agent's own name, for the timeline entry the screen appends without
    // refetching. Read inside the transaction; it cannot have changed.
    const who = await client.query('SELECT name FROM users WHERE id = $1', [agentId]);

    await client.query('COMMIT');

    const row = rows[0];
    return {
      ok: true,
      disposition: {
        id: row.id,
        leadId: row.lead_id,
        agentId: row.agent_id,
        agentName: who.rows[0]?.name ?? null,
        value: row.value,
        createdAt: row.created_at.toISOString(),
        blockedNumber,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
