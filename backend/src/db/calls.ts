/**
 * Calls: starting one, and recording how it ended - Phase 4, TWILIO.md.
 *
 * A call is one row in `calls`, keyed by Twilio's CallSid for the agent's
 * browser leg. It is written when Twilio asks our voice webhook how to connect
 * the call, and finished when Twilio reports that the lead's leg ended. Both
 * writes are idempotent, because Twilio retries a webhook that does not answer
 * in time.
 *
 * Every row also makes its lead Working (db/lead-state.ts) and counts as the
 * agent's activity on Admin > Overview; nothing here needs to know that.
 */

import { activityInsertSql, recordActivity } from './activity';
import { pool } from './pool';
import type { CallOutcome, CallRefusal } from '../core/calls';

export type StartCallResult = { ok: true; phone: string } | { ok: false; reason: CallRefusal };

/**
 * Checks the call may be placed and records it, in one transaction.
 *
 * The rules are the ones every other write on a lead follows: the agent must
 * be active and hold the lead (AGENT-WORKSPACE.md, "Rules"), and the number
 * must not be on the do-not-call list - a DNC blocks calls as well as texts
 * (CLAUDE.md §6). The lead row is locked so a release or a DNC cannot land
 * between the check and the insert.
 *
 * A retry from Twilio carries the same CallSid: the row already exists, the
 * insert does nothing, and the call is connected again rather than refused.
 */
export async function startCall(opts: {
  callSid: string;
  leadId: number;
  agentId: number;
}): Promise<StartCallResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ phone: string; holds: boolean; blocked: boolean }>(
      `SELECT l.phone,
              EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_active AND l.assigned_to = u.id) AS holds,
              EXISTS (SELECT 1 FROM dnc_list d WHERE d.phone = l.phone AND d.released_at IS NULL) AS blocked
       FROM leads l
       WHERE l.id = $1
       FOR UPDATE OF l`,
      [opts.leadId, opts.agentId]
    );

    const lead = rows[0];
    const refusal: CallRefusal | null = !lead ? 'not_found' : !lead.holds ? 'not_holder' : lead.blocked ? 'blocked' : null;
    if (refusal) {
      // A refused call leaves no `calls` row, so the log is its only record.
      // Committed, not rolled back: nothing else was written in this
      // transaction. An unknown lead has no row to point at; its id is kept in
      // the detail instead.
      await recordActivity(client, {
        action: 'call.refused',
        actorId: opts.agentId,
        leadId: lead ? opts.leadId : null,
        detail: { reason: refusal, callSid: opts.callSid, ...(lead ? {} : { leadId: opts.leadId }) },
      });
      await client.query('COMMIT');
      return { ok: false, reason: refusal };
    }

    const inserted = await client.query(
      `INSERT INTO calls (lead_id, agent_id, twilio_call_sid, started_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (twilio_call_sid) DO NOTHING
       RETURNING id`,
      [opts.leadId, opts.agentId, opts.callSid]
    );
    // Only the first request starts the call; a retry from Twilio records nothing more.
    if (inserted.rowCount === 1) {
      await recordActivity(client, {
        action: 'call.started',
        actorId: opts.agentId,
        leadId: opts.leadId,
        detail: { callId: inserted.rows[0].id, callSid: opts.callSid },
      });
    }

    await client.query('COMMIT');
    return { ok: true, phone: lead.phone };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Records how the call ended. Only the first report counts: a retried or late
 * callback cannot overwrite an outcome already saved. False when no unfinished
 * call has that CallSid - a call from another app on the account, or a repeat.
 */
export async function finishCall(opts: {
  callSid: string;
  outcome: CallOutcome;
  durationSec: number;
}): Promise<boolean> {
  // Twilio reported it, so there is no actor; the agent who placed the call is
  // the subject.
  const { rowCount } = await pool.query(
    `WITH ended AS (
       UPDATE calls
       SET outcome = $2, duration_sec = $3, ended_at = now()
       WHERE twilio_call_sid = $1 AND ended_at IS NULL
       RETURNING id, lead_id, agent_id
     ),
     logged AS (
       ${activityInsertSql}
       SELECT NULL, 'call.ended', lead_id, agent_id,
              jsonb_build_object('callId', id, 'callSid', $1::text,
                                 'outcome', $2::text, 'durationSec', $3::int)
       FROM ended
     )
     SELECT 1 FROM ended`,
    [opts.callSid, opts.outcome, opts.durationSec]
  );
  return (rowCount ?? 0) > 0;
}
