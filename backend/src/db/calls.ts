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
import { finishMissedCallCallbacks } from './callbacks';
import { pool } from './pool';
import type { AnsweredBy, CallOutcome, CallRefusal } from '../core/calls';

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
      // Calling the lead is returning their missed call, whoever's callback it was.
      await finishMissedCallCallbacks(client, opts.leadId, opts.agentId, 'called_back');
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

export interface FinishedCall {
  /** False when no unfinished call has that CallSid - another app's call, or a repeat report. */
  recorded: boolean;
  /** The lead whose incoming call this report turned into a missed call. Null otherwise. */
  missedLeadId: number | null;
}

/**
 * Records how the call ended. Only the first report counts: a retried or late
 * callback cannot overwrite an outcome already saved.
 *
 * An incoming call that was not answered is saved as `missed`, whatever Twilio
 * called it - no answer, declined, the agent not signed in, the lead hanging
 * up first. `missedLeadId` tells the caller that this report is the one that
 * made it a missed call, so the lead is texted once and only once.
 *
 * **A missed call becomes a callback for the agent it rang** - Jeel,
 * 2026-10-01 - due now, so it is at the top of their My Callbacks. The queue's
 * Missed call tag says a lead needs calling; this says whose job it is. Not
 * booked when the lead already has one open (three missed calls are one call
 * to return), when the agent has since been deactivated, or when the number
 * is on the do-not-call list, which a call back would be refused for anyway.
 *
 * **And an incoming call that is answered finishes that callback**: the lead
 * rang again and got through, so there is nothing left to return.
 *
 * All of it is one statement, so the call, its callback and their records
 * are written together or not at all.
 */
export async function finishCall(opts: {
  callSid: string;
  outcome: CallOutcome;
  durationSec: number;
}): Promise<FinishedCall> {
  // Twilio reported it, so there is no actor; the agent on the call is the
  // subject.
  const { rows } = await pool.query<{ lead_id: number; missed: boolean }>(
    `WITH ended AS (
       UPDATE calls
       SET outcome = CASE
             WHEN direction = 'inbound' AND $2 <> 'answered' THEN 'missed'
             -- Picked up, but by a machine: the verdict got here first.
             WHEN $2 = 'answered' AND answered_by IN ('machine', 'fax') THEN 'voicemail'
             ELSE $2
           END,
           duration_sec = $3,
           ended_at = now()
       WHERE twilio_call_sid = $1 AND ended_at IS NULL
       RETURNING id, lead_id, agent_id, direction, outcome
     ),
     booked AS (
       INSERT INTO callbacks (lead_id, agent_id, scheduled_at, reason)
       SELECT e.lead_id, e.agent_id, now(), 'missed_call'
       FROM ended e
       JOIN leads l ON l.id = e.lead_id
       JOIN users u ON u.id = e.agent_id AND u.is_active
       WHERE e.outcome = 'missed'
         AND NOT EXISTS (
           SELECT 1 FROM callbacks cb
           WHERE cb.lead_id = e.lead_id AND cb.done_at IS NULL AND cb.reason = 'missed_call'
         )
         AND NOT EXISTS (SELECT 1 FROM dnc_list d WHERE d.phone = l.phone AND d.released_at IS NULL)
       RETURNING id, lead_id, agent_id, scheduled_at
     ),
     returned AS (
       UPDATE callbacks cb SET done_at = now()
       FROM ended e
       WHERE e.direction = 'inbound' AND e.outcome = 'answered'
         AND cb.lead_id = e.lead_id AND cb.done_at IS NULL AND cb.reason = 'missed_call'
       RETURNING cb.id, cb.lead_id, cb.agent_id, cb.scheduled_at, e.agent_id AS answered_by
     ),
     logged AS (
       ${activityInsertSql}
       SELECT NULL::int, CASE WHEN outcome = 'missed' THEN 'call.missed' ELSE 'call.ended' END, lead_id, agent_id,
              jsonb_build_object('callId', id, 'callSid', $1::text, 'direction', direction,
                                 'outcome', outcome, 'durationSec', $3::int)
       FROM ended
       UNION ALL
       SELECT NULL::int, 'callback.booked', lead_id, agent_id,
              jsonb_build_object('callbackId', id, 'scheduledAt', scheduled_at, 'because', 'missed_call')
       FROM booked
       UNION ALL
       SELECT answered_by, 'callback.done', lead_id, agent_id,
              jsonb_build_object('callbackId', id, 'scheduledAt', scheduled_at, 'because', 'answered')
       FROM returned
     )
     SELECT lead_id, outcome = 'missed' AS missed FROM ended`,
    [opts.callSid, opts.outcome, opts.durationSec]
  );
  const ended = rows[0];
  return { recorded: Boolean(ended), missedLeadId: ended?.missed ? ended.lead_id : null };
}

/**
 * Records who picked up a call we placed - a person or a machine - and, when it
 * was a machine, saves the call as `voicemail` rather than `answered`.
 *
 * The verdict and the end of the call arrive in either order: detection takes
 * a few seconds, and a short call can be over before it reports. So this
 * corrects an `answered` call that has already ended, and `finishCall` reads
 * the verdict for one that has not. Only the first verdict counts.
 *
 * Changing `answered` to `voicemail` overwrites what the row said, so the
 * record keeps both - docs/AUDIT.md. One statement: the row and its record
 * are written together.
 */
export async function recordAnsweredBy(opts: { callSid: string; answeredBy: AnsweredBy }): Promise<boolean> {
  const { rowCount } = await pool.query(
    `WITH prev AS (
       SELECT id, outcome FROM calls
       WHERE twilio_call_sid = $1 AND direction = 'outbound' AND answered_by IS NULL
       FOR UPDATE
     ),
     verdict AS (
       UPDATE calls c
       SET answered_by = $2,
           outcome = CASE WHEN prev.outcome = 'answered' AND $2 IN ('machine', 'fax') THEN 'voicemail' ELSE c.outcome END
       FROM prev
       WHERE c.id = prev.id
       RETURNING c.id, c.lead_id, c.agent_id, c.outcome, prev.outcome AS outcome_was
     ),
     logged AS (
       ${activityInsertSql}
       SELECT NULL::int, 'call.answered_by', lead_id, agent_id,
              jsonb_strip_nulls(jsonb_build_object(
                'callId', id, 'callSid', $1::text, 'answeredBy', $2::text,
                'outcome', outcome,
                'outcomeWas', CASE WHEN outcome IS DISTINCT FROM outcome_was THEN outcome_was END
              ))
       FROM verdict
     )
     SELECT 1 FROM verdict`,
    [opts.callSid, opts.answeredBy]
  );
  return rowCount === 1;
}

export type IncomingCall =
  /** Ring this agent's browser. */
  | { kind: 'ring'; agentId: number; lead: { id: number; name: string; phone: string } }
  /**
   * A lead we hold, but no agent to ring. Already saved as missed. `firstReport`
   * is false on a retried webhook, so the lead is not texted twice.
   */
  | { kind: 'missed'; leadId: number; firstReport: boolean }
  /** Nobody we know. Nothing to ring and no lead to record it against. */
  | { kind: 'unknown' };

/**
 * A lead is calling our number: decides whose browser rings, and records the
 * call - Jeel, 2026-10-01.
 *
 * **Whose.** The agent holding the lead; failing that, the agent who last
 * called them, since theirs is the call being returned. Only an active agent
 * counts. With neither, nobody rings: there is no "everyone" to ring yet - a
 * shared incoming queue is a later piece of work - and the call is saved as
 * missed straight away, so the lead is texted and shows in the queue.
 *
 * A number we hold no lead for is `unknown`. `calls` needs a lead, so that call
 * is kept only in the activity log, by its phone number.
 *
 * Idempotent like `startCall`: a retried webhook finds the row and rings again.
 */
export async function startIncomingCall(opts: { callSid: string; fromPhone: string }): Promise<IncomingCall> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{
      id: number;
      first_name: string | null;
      last_name: string | null;
      phone: string;
      agent_id: number | null;
    }>(
      `SELECT l.id, l.first_name, l.last_name, l.phone,
              COALESCE(
                (SELECT u.id FROM users u WHERE u.id = l.assigned_to AND u.is_active),
                (SELECT c.agent_id FROM calls c
                 JOIN users u ON u.id = c.agent_id AND u.is_active
                 WHERE c.lead_id = l.id AND c.direction = 'outbound'
                 ORDER BY c.id DESC LIMIT 1)
              ) AS agent_id
       FROM leads l
       WHERE l.phone = $1
       FOR UPDATE OF l`,
      [opts.fromPhone]
    );
    const lead = rows[0];

    if (!lead) {
      await recordActivity(client, {
        action: 'call.incoming',
        actorId: null,
        detail: { callSid: opts.callSid, phone: opts.fromPhone, known: false },
      });
      await client.query('COMMIT');
      return { kind: 'unknown' };
    }

    // With nobody to ring it is over before it starts: saved as missed now.
    const nobody = lead.agent_id === null;
    const inserted = await client.query(
      `INSERT INTO calls (lead_id, agent_id, twilio_call_sid, started_at, direction, outcome, duration_sec, ended_at)
       VALUES ($1, $2, $3, now(), 'inbound',
               CASE WHEN $4::boolean THEN 'missed' END,
               CASE WHEN $4::boolean THEN 0 END,
               CASE WHEN $4::boolean THEN now() END)
       ON CONFLICT (twilio_call_sid) DO NOTHING
       RETURNING id`,
      [lead.id, lead.agent_id, opts.callSid, nobody]
    );
    if (inserted.rowCount === 1) {
      await recordActivity(client, {
        action: nobody ? 'call.missed' : 'call.incoming',
        actorId: null,
        leadId: lead.id,
        subjectUserId: lead.agent_id,
        detail: { callId: inserted.rows[0].id, callSid: opts.callSid, ...(nobody ? { because: 'no_agent' } : {}) },
      });
    }

    await client.query('COMMIT');

    if (nobody) {
      return { kind: 'missed', leadId: lead.id, firstReport: inserted.rowCount === 1 };
    }
    return {
      kind: 'ring',
      agentId: lead.agent_id!,
      lead: {
        id: lead.id,
        name: [lead.first_name, lead.last_name].filter(Boolean).join(' '),
        phone: lead.phone,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
