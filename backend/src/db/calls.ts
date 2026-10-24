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
import { FREE_SQL } from './presence';
import type { AnsweredBy, CallOutcome, CallRefusal } from '../core/calls';
import { MAX_RUNG_AT_ONCE } from '../core/call-script';

/**
 * An automated call Twilio's verdict took over - T18, AUTO-CALLS.md
 * "Voicemail": the voicemail message left, or a fax hung up on (the only
 * `unanswered` call a fax picked up). Only such a call is saved as
 * `voicemail` for a machine's verdict: one the call ignored - a person Twilio
 * got wrong - stays `answered`. Bare column names, for any query on `calls`.
 */
export const TAKEN_BY_VERDICT_SQL = `(script_result = 'voicemail_left' OR (script_result = 'unanswered' AND answered_by = 'fax'))`;

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
             -- Picked up, but by a machine: the verdict got here first. An
             -- automated call only when the verdict took it over (T18).
             WHEN $2 = 'answered' AND answered_by IN ('machine', 'fax')
                  AND (direction <> 'automated' OR ${TAKEN_BY_VERDICT_SQL}) THEN 'voicemail'
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
 * was a machine, saves an agent's call as `voicemail` rather than `answered`.
 * An agent's call or an automated one (T4); an automated call is `voicemail`
 * only when the verdict took it over (T18, `TAKEN_BY_VERDICT_SQL`), which
 * `finishCall` reads at its end - a verdict after the end is never acted on.
 *
 * The verdict and the end of the call arrive in either order: detection takes
 * a few seconds, and a short call can be over before it reports. So this
 * corrects an agent's `answered` call that has already ended, and `finishCall`
 * reads the verdict for one that has not. Only the first verdict counts.
 *
 * Changing `answered` to `voicemail` overwrites what the row said, so the
 * record keeps both - docs/AUDIT.md. One statement: the row and its record
 * are written together.
 */
export async function recordAnsweredBy(opts: { callSid: string; answeredBy: AnsweredBy }): Promise<boolean> {
  const { rowCount } = await pool.query(
    `WITH prev AS (
       SELECT id, outcome, direction FROM calls
       WHERE twilio_call_sid = $1 AND direction IN ('outbound', 'automated') AND answered_by IS NULL
       FOR UPDATE
     ),
     verdict AS (
       UPDATE calls c
       SET answered_by = $2,
           outcome = CASE
             WHEN prev.outcome = 'answered' AND $2 IN ('machine', 'fax') AND prev.direction = 'outbound' THEN 'voicemail'
             ELSE c.outcome
           END
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
   * Ring everyone free together - a lead nobody holds or has called (T19,
   * with automated calls on). The call is nobody's until one of them takes it
   * (`takeIncomingCall`).
   */
  | { kind: 'group'; agentIds: number[]; lead: { id: number; name: string; phone: string } }
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
 * counts, switch or not. With neither, and `ringFree` - automated calls on
 * (T19, AUTO-CALLS.md "A lead calling back") - everyone free rings together
 * (`FREE_SQL`, at most ten): a lead returning the robot's voicemail has no
 * agent yet. With nobody to ring, the call is saved as missed straight away,
 * so the lead is texted and shows in the queue.
 *
 * A number we hold no lead for is `unknown`. `calls` needs a lead, so that call
 * is kept only in the activity log, by its phone number.
 *
 * Idempotent like `startCall`: a retried webhook finds the row and keeps what
 * was decided the first time - see below.
 */
export async function startIncomingCall(opts: {
  callSid: string;
  fromPhone: string;
  ringFree?: boolean;
}): Promise<IncomingCall> {
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
                 -- An automated call counts once a person took it (T4).
                 WHERE c.lead_id = l.id AND c.direction IN ('outbound', 'automated')
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
    const who = { id: lead.id, name: [lead.first_name, lead.last_name].filter(Boolean).join(' '), phone: lead.phone };
    const everyoneFree = async () =>
      (
        await client.query<{ id: number }>(`SELECT u.id FROM users u WHERE ${FREE_SQL} ORDER BY u.id LIMIT ${MAX_RUNG_AT_ONCE}`)
      ).rows.map((r) => r.id);

    // Twilio asking again about the same call: what was decided the first
    // time holds - a call that is over stays over, one agent's ring rings them
    // again, and a ring to everyone free rings whoever is free now. Nobody
    // free now, that call is missed at once, and only then texted.
    const { rows: before } = await client.query<{ id: number; agent_id: number | null; ended: boolean }>(
      `SELECT id, agent_id, ended_at IS NOT NULL AS ended FROM calls WHERE twilio_call_sid = $1 AND direction = 'inbound'`,
      [opts.callSid]
    );
    if (before[0]) {
      const call = before[0];
      let again: IncomingCall;
      if (call.ended) again = { kind: 'missed', leadId: lead.id, firstReport: false };
      else if (call.agent_id !== null) again = { kind: 'ring', agentId: call.agent_id, lead: who };
      else {
        const free = await everyoneFree();
        if (free.length > 0) again = { kind: 'group', agentIds: free, lead: who };
        else {
          await client.query(`UPDATE calls SET outcome = 'missed', duration_sec = 0, ended_at = now() WHERE id = $1`, [call.id]);
          await recordActivity(client, {
            action: 'call.missed',
            actorId: null,
            leadId: lead.id,
            detail: { callId: call.id, callSid: opts.callSid, because: 'no_agent' },
          });
          again = { kind: 'missed', leadId: lead.id, firstReport: true };
        }
      }
      await client.query('COMMIT');
      return again;
    }

    // Nobody's own: everyone free, when automated calls are on (T19).
    const free = lead.agent_id === null && opts.ringFree ? await everyoneFree() : [];

    // With nobody to ring it is over before it starts: saved as missed now.
    const nobody = lead.agent_id === null && free.length === 0;
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
        detail: {
          callId: inserted.rows[0].id,
          callSid: opts.callSid,
          ...(nobody ? { because: 'no_agent' } : {}),
          ...(free.length > 0 ? { ring: 'group', rung: free.length } : {}),
        },
      });
    }

    await client.query('COMMIT');

    if (nobody) {
      return { kind: 'missed', leadId: lead.id, firstReport: inserted.rowCount === 1 };
    }
    if (lead.agent_id === null) return { kind: 'group', agentIds: free, lead: who };
    return { kind: 'ring', agentId: lead.agent_id, lead: who };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export type TakeIncomingResult =
  | { ok: true; leadId: number; tookOverFrom: number | null }
  | { ok: false; reason: 'taken' | 'inactive' | 'not_found' };

/**
 * A person accepted a lead's call that rang everyone free (T19): the call
 * becomes theirs - `agent_id`, so they are on a call - with its `call.taken`
 * record, and so does the lead, taken over from anyone who held it, with its
 * `lead.picked_up` (`via: 'call_back'`) - in one transaction, as a transfer
 * taken (`takeTransfer`). Their browser picks the lead up too as it accepts,
 * and that can get here first; but in two accepts at once it can be the
 * other person's, so the lead follows the call. The first to accept only:
 * Twilio connects one person, and a second request - someone else's, or an
 * account deactivated meanwhile - is refused, and that leg is hung up. The
 * same person again changes nothing. `callSid` is the lead's call - our row's.
 */
export async function takeIncomingCall(callSid: string, agentId: number): Promise<TakeIncomingResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: number; lead_id: number; agent_id: number | null; assigned_to: number | null }>(
      `SELECT c.id, c.lead_id, c.agent_id, l.assigned_to
       FROM calls c JOIN leads l ON l.id = c.lead_id
       WHERE c.twilio_call_sid = $1 AND c.direction = 'inbound' AND c.ended_at IS NULL
       FOR UPDATE OF c, l`,
      [callSid]
    );
    const call = rows[0];
    const refuse = async (reason: 'not_found' | 'taken' | 'inactive') => {
      await client.query('ROLLBACK');
      return { ok: false as const, reason };
    };
    if (!call) return await refuse('not_found');
    if (call.agent_id !== null && call.agent_id !== agentId) return await refuse('taken');
    const agent = await client.query(`SELECT 1 FROM users WHERE id = $1 AND is_active`, [agentId]);
    if (agent.rowCount === 0) return await refuse('inactive');

    const tookOverFrom = call.assigned_to !== null && call.assigned_to !== agentId ? call.assigned_to : null;
    if (call.agent_id === null) {
      await client.query(`UPDATE calls SET agent_id = $2 WHERE id = $1`, [call.id, agentId]);
      await recordActivity(client, {
        action: 'call.taken',
        actorId: agentId,
        leadId: call.lead_id,
        detail: { callId: call.id, callSid, ...(tookOverFrom === null ? {} : { tookOverFrom }) },
      });
    }
    if (call.assigned_to !== agentId) {
      await client.query(`UPDATE leads SET assigned_to = $2, assigned_at = now(), updated_at = now() WHERE id = $1`, [
        call.lead_id,
        agentId,
      ]);
      await recordActivity(client, {
        action: 'lead.picked_up',
        actorId: agentId,
        leadId: call.lead_id,
        detail: { via: 'call_back', callId: call.id, ...(tookOverFrom === null ? {} : { tookOverFrom }) },
      });
    }

    await client.query('COMMIT');
    return { ok: true, leadId: call.lead_id, tookOverFrom };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
