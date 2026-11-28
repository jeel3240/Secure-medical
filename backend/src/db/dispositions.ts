/**
 * Setting a disposition - what the agent concluded about a lead - and the DNC
 * path that blocks the number.
 *
 * AGENT-WORKSPACE.md, "Dispositions"; DESIGN-PROMPT.md section 3, right column.
 */

import { recordActivity } from './activity';
import { newestConversation } from './lead-state';
import { pool } from './pool';
import { blockNumber, DNC_REASONS } from './dnc';
import { DNC_DISPOSITION, type CloseReason, type Disposition } from '../core/dispositions';

export interface DispositionRow {
  id: number;
  leadId: number;
  agentId: number;
  agentName: string | null;
  value: Disposition;
  /** Why it was closed - Sold, Not interested, Wrong number (B04). Null on DNC, and on a Closed saved without one. */
  reason: CloseReason | null;
  /** The conversation it was saved against: the lead's newest. Null for a lead with none. */
  conversationId: number | null;
  createdAt: string;
  /** True when this disposition blocked the number. Only ever true for `dnc`. */
  blockedNumber: boolean;
  /** True when this disposition let go of the agent's claim - both values do. */
  released: boolean;
}

export type SetDispositionResult =
  | { ok: true; disposition: DispositionRow }
  | { ok: false; reason: 'lead_not_found' }
  /** Another active person holds it now - released and picked up since the route checked (review M10). */
  | { ok: false; reason: 'not_yours' };

/**
 * Records the disposition, and blocks the number when it is `dnc`.
 *
 * **Append-only, like notes.** Nothing updates or deletes a disposition; an
 * agent who changes their mind adds another and the newest wins wherever one
 * value is needed. The timeline shows the sequence, which is the point: a lead
 * closed, reopened by a callback and closed again is a different story from
 * one closed once.
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
 *
 * **Closed says why - B04, Jeel 2026-11-27.** `reason` is Sold, Not interested
 * or Wrong number, written in the same row, and the row names the conversation
 * it closed: the lead's newest, read under the lead's lock in the same
 * statement, so it is the one the agent saw. The route checks the reason; the
 * database refuses one on DNC, or a word it does not know. A Closed with no
 * reason is still saved, as NULL, for a browser still on the page from before.
 *
 * **Both outcomes finish the lead, so both release it - Jeel, 2026-09-29.**
 * Until then a closed lead stayed claimed until the agent pressed Back to
 * queue, and so stayed in the queue as "Working - name": nobody needed to pick
 * it up, yet it was still there. Now the claim is cleared in the same
 * transaction, and the lead leaves the queue the moment the outcome is saved.
 * The unread flag is cleared with it: whoever closed the lead was looking at
 * it, and an unread reply would otherwise keep a closed lead in the queue
 * (`db/lead-state.ts`). A text that arrives *after* closing sets it again and
 * brings the lead back, as before.
 *
 * **And both finish any callback still open - Jeel, 2026-09-29.** A lead that
 * is finished has no call left to make; until then its callback stayed on the
 * agent's My Callbacks, and in the queue's Callback status, until marked done
 * by hand. A callback booked *after* closing is untouched - that is how "call
 * me Friday" reopens a lead.
 */
export async function setDisposition(
  leadId: number,
  agentId: number,
  value: Disposition,
  reason: CloseReason | null = null
): Promise<SetDispositionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Locked, so the phone cannot change under the block between reading it
    // and writing dnc_list. Also gives the clean 404 for an unknown lead.
    const lead = await client.query(
      `SELECT id, phone, assigned_to, assigned_at, has_unread_inbound,
              EXISTS (SELECT 1 FROM users u WHERE u.id = leads.assigned_to AND u.is_active AND u.id <> $2) AS someone_else_holds
       FROM leads WHERE id = $1 FOR UPDATE`,
      [leadId, agentId]
    );
    if (!lead.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'lead_not_found' };
    }
    // Not someone else's now, under the lock: the route asked before, and a release and someone else's pick-up in
    // between let one agent's outcome release another's claim and close their call backs (review M10, 2026-11-22).
    if (lead.rows[0].someone_else_holds) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_yours' };
    }

    const { rows } = await client.query(
      `INSERT INTO dispositions (lead_id, agent_id, value, reason, conversation_id)
       SELECT l.id, $2, $3, $4, c.id
       FROM leads l
       LEFT JOIN ${newestConversation('c.id')}
       WHERE l.id = $1
       RETURNING id, lead_id, agent_id, value, reason, conversation_id, created_at`,
      [leadId, agentId, value, reason]
    );

    await recordActivity(client, {
      action: 'outcome.set',
      actorId: agentId,
      leadId,
      detail: { value, reason, dispositionId: rows[0].id },
    });

    const blockedNumber = value === DNC_DISPOSITION;
    if (blockedNumber) {
      await blockNumber(client, lead.rows[0].phone, DNC_REASONS.agentDisposition, agentId);
      // The same end state as a STOP reply: a question flow still under way is
      // over. AGENT-WORKSPACE.md said so from the start; until 2026-10-01 the
      // conversation was left open - nothing could be sent, the block saw to
      // that, but it sat open until it expired and a later START was read as
      // an unclear answer to a question nobody was asking.
      await client.query(
        `UPDATE conversations SET status = 'suppressed', updated_at = now()
         WHERE lead_id = $1 AND status = 'open'`,
        [leadId]
      );
    }

    await client.query(
      `UPDATE leads SET assigned_to = NULL, assigned_at = NULL, has_unread_inbound = false
       WHERE id = $1`,
      [leadId]
    );
    // An unread reply cleared by the outcome is read, by who set it - as opening the lead records it (review M20).
    if (lead.rows[0].has_unread_inbound) {
      await recordActivity(client, { action: 'reply.read', actorId: agentId, leadId, detail: { because: 'outcome' } });
    }

    // The outcome let go of the lead: the same record a release writes, so the
    // log always says how long a lead was held, whichever way it was let go.
    const { assigned_to: holder, assigned_at: heldSince } = lead.rows[0];
    if (holder !== null) {
      await recordActivity(client, {
        action: 'lead.released',
        actorId: agentId,
        leadId,
        subjectUserId: holder,
        detail: { heldSince, forced: holder !== agentId, because: 'outcome' },
      });
    }

    const finished = await client.query(
      `UPDATE callbacks SET done_at = now() WHERE lead_id = $1 AND done_at IS NULL
       RETURNING id, agent_id, scheduled_at`,
      [leadId]
    );
    for (const callback of finished.rows) {
      await recordActivity(client, {
        action: 'callback.done',
        actorId: agentId,
        leadId,
        subjectUserId: callback.agent_id,
        detail: { callbackId: callback.id, scheduledAt: callback.scheduled_at, because: 'outcome' },
      });
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
        reason: row.reason,
        conversationId: row.conversation_id,
        createdAt: row.created_at.toISOString(),
        blockedNumber,
        released: true,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
