/**
 * Callbacks: an agent's promise to ring a lead back at a time.
 *
 * Created from the workspace, listed on My Callbacks, rescheduled or marked
 * done from either. AGENT-WORKSPACE.md, "Endpoints"; DESIGN-PROMPT.md 5.
 */

import { startOfTodaySql } from './sql';
import { activityInsertSql, type ActivityWriter } from './activity';
import { pool } from './pool';

export type CallbackWhen = 'today' | 'upcoming' | 'overdue' | 'all';

/**
 * Why a callback exists. `booked`: a person booked it. `missed_call`: the lead
 * rang, the agent it rang did not pick up, and the system booked it for them -
 * `db/calls.ts`, `finishCall`.
 */
export type CallbackReason = 'booked' | 'missed_call';

export interface Callback {
  id: number;
  leadId: number;
  agentId: number;
  agentName: string;
  scheduledAt: string;
  doneAt: string | null;
  reason: CallbackReason;
}

/** A row on My Callbacks: the callback, plus enough of the lead to act on it. */
export interface CallbackListRow extends Callback {
  lead: {
    phone: string;
    firstName: string | null;
    lastName: string | null;
    source: string | null;
    tier: string | null;
  };
  /** The most recent note on the lead, for the excerpt column. */
  latestNote: string | null;
  /**
   * Who holds the lead right now, if anyone active - so the row can say Resume
   * to its holder instead of Pick up, and not offer a claim that would fail to
   * anyone else. Added 2026-09-29.
   */
  holder: { id: number; name: string } | null;
  /**
   * For a missed call's callback: how many calls it stands for, and when the
   * latest was. A lead who rings three times is one callback, and the row
   * should say three and show the last time, not the first. Read from `calls`
   * rather than written onto the callback, so nothing is overwritten. Null for
   * a callback a person booked.
   */
  missedCalls: { count: number; lastAt: string } | null;
}

export type CreateResult =
  | { ok: true; callback: Callback }
  | { ok: false; reason: 'lead_not_found' }
  | { ok: false; reason: 'agent_not_found' };

export type UpdateResult =
  | { ok: true; callback: Callback }
  | { ok: false; reason: 'not_found' }
  /** Someone else's callback, and the caller is not a superadmin. */
  | { ok: false; reason: 'not_yours'; ownerName: string };

async function readCallback(id: number): Promise<Callback | null> {
  const { rows } = await pool.query(
    `SELECT cb.id, cb.lead_id, cb.agent_id, cb.scheduled_at, cb.done_at, cb.reason, u.name
     FROM callbacks cb
     LEFT JOIN users u ON u.id = cb.agent_id
     WHERE cb.id = $1`,
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    leadId: r.lead_id,
    agentId: r.agent_id,
    agentName: r.name ?? '',
    scheduledAt: r.scheduled_at.toISOString(),
    doneAt: r.done_at?.toISOString() ?? null,
    reason: r.reason,
  };
}

/**
 * Finishes the callback a missed call left, because the lead has now been
 * got back to: an agent called them, texted them, or answered when they rang
 * again - the same three things that clear the Missed call tag
 * (`db/lead-state.ts`, `MISSED_CALL_SQL`).
 *
 * Only the system's own callbacks. One an agent booked themselves is theirs to
 * finish. `q` is the caller's transaction, so the callback and the call or
 * text that finished it commit together; the record is in the same statement.
 */
export async function finishMissedCallCallbacks(
  q: ActivityWriter,
  leadId: number,
  /** Who got back to the lead. */
  actorId: number,
  because: 'called_back' | 'texted_back'
): Promise<void> {
  await q.query(
    `WITH finished AS (
       UPDATE callbacks SET done_at = now()
       WHERE lead_id = $1 AND done_at IS NULL AND reason = 'missed_call'
       RETURNING id, lead_id, agent_id, scheduled_at
     )
     ${activityInsertSql}
     SELECT $2::int, 'callback.done', lead_id, agent_id,
            jsonb_build_object('callbackId', id, 'scheduledAt', scheduled_at, 'because', $3::text)
     FROM finished`,
    [leadId, actorId, because]
  );
}

/**
 * Schedules a callback.
 *
 * `agentId` defaults to the caller; a superadmin may assign another agent, and
 * the route is what enforces that. Several callbacks on one lead are allowed -
 * an agent who rings and misses may book another, and the timeline shows the
 * sequence.
 *
 * A time in the past is accepted. It arrives overdue, which is exactly what My
 * Callbacks shows in red, and refusing it would stop an agent recording a
 * promise they have already broken.
 */
export async function createCallback(
  leadId: number,
  agentId: number,
  scheduledAt: Date,
  /** Who booked it. The agent it is for, unless a superadmin booked it for them. */
  actorId: number = agentId
): Promise<CreateResult> {
  const lead = await pool.query(`SELECT 1 FROM leads WHERE id = $1`, [leadId]);
  if (lead.rowCount === 0) return { ok: false, reason: 'lead_not_found' };

  const agent = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND is_active`, [agentId]);
  if (agent.rowCount === 0) return { ok: false, reason: 'agent_not_found' };

  // The callback and its record in one statement - docs/AUDIT.md.
  const { rows } = await pool.query(
    `WITH booked AS (
       INSERT INTO callbacks (lead_id, agent_id, scheduled_at) VALUES ($1, $2, $3)
       RETURNING id, scheduled_at
     ),
     logged AS (
       ${activityInsertSql}
       SELECT $4::int, 'callback.booked', $1, $2,
              jsonb_build_object('callbackId', id, 'scheduledAt', scheduled_at)
       FROM booked
     )
     SELECT id FROM booked`,
    [leadId, agentId, scheduledAt, actorId]
  );

  return { ok: true, callback: (await readCallback(rows[0].id))! };
}

/**
 * Reschedules a callback, marks it done, or both.
 *
 * An agent may change only their own; a superadmin may change anyone's, which
 * is how a callback left by someone off sick gets moved.
 *
 * Marking an already-done callback done again is a success and leaves the
 * original `done_at` alone: the caller wanted it done, and it was - overwriting
 * would rewrite when the work actually happened.
 */
export async function updateCallback(
  id: number,
  actorId: number,
  isSuperadmin: boolean,
  patch: { scheduledAt?: Date; done?: boolean }
): Promise<UpdateResult> {
  const existing = await readCallback(id);
  if (!existing) return { ok: false, reason: 'not_found' };

  if (!isSuperadmin && existing.agentId !== actorId) {
    return { ok: false, reason: 'not_yours', ownerName: existing.agentName };
  }

  // The update overwrites the time and the done mark, so the statement records
  // what they were: one row per thing that actually changed, none when nothing
  // did. Until 2026-10-01 a rescheduled callback kept no trace of its original
  // time - docs/AUDIT.md.
  await pool.query(
    `WITH prev AS (
       SELECT id, scheduled_at, done_at FROM callbacks WHERE id = $1 FOR UPDATE
     ),
     changed AS (
       UPDATE callbacks c
       SET scheduled_at = COALESCE($2, prev.scheduled_at),
           done_at = CASE
             WHEN $3::boolean IS TRUE THEN COALESCE(prev.done_at, now())
             WHEN $3::boolean IS FALSE THEN NULL
             ELSE prev.done_at
           END
       FROM prev
       WHERE c.id = prev.id
       RETURNING c.id, c.lead_id, c.agent_id, c.scheduled_at, c.done_at,
                 prev.scheduled_at AS old_scheduled_at, prev.done_at AS old_done_at
     ),
     logged AS (
       ${activityInsertSql}
       SELECT $4::int, 'callback.rescheduled', lead_id, agent_id,
              jsonb_build_object('callbackId', id, 'from', old_scheduled_at, 'to', scheduled_at)
       FROM changed WHERE scheduled_at IS DISTINCT FROM old_scheduled_at
       UNION ALL
       SELECT $4::int, 'callback.done', lead_id, agent_id,
              jsonb_build_object('callbackId', id, 'scheduledAt', scheduled_at)
       FROM changed WHERE old_done_at IS NULL AND done_at IS NOT NULL
       UNION ALL
       SELECT $4::int, 'callback.reopened', lead_id, agent_id,
              jsonb_build_object('callbackId', id, 'wasDoneAt', old_done_at)
       FROM changed WHERE old_done_at IS NOT NULL AND done_at IS NULL
     )
     SELECT 1 FROM changed`,
    [id, patch.scheduledAt ?? null, patch.done ?? null, actorId]
  );

  return { ok: true, callback: (await readCallback(id))! };
}

/**
 * The tabs on My Callbacks.
 *
 * `today` is the rest of today, not the whole day: a callback at 9am seen at
 * 3pm is overdue, and showing it under both would hide that it was missed.
 * `overdue` is everything past its time and still not done.
 *
 * **A call missed today is under Today, not Overdue** - Jeel, 2026-10-01. Its
 * callback is due the moment the call was missed, so by the rule above it
 * would be overdue a second later and never appear on the tab an agent opens.
 * It is today's work: it stays under Today, first in the list, until the day
 * ends, and only then is it overdue.
 *
 * Days are the viewer's, from `timeZone` - `db/sql.ts`, `startOfTodaySql`.
 */
function whenSql(timeZone?: string): Record<Exclude<CallbackWhen, 'all'>, string> {
  const today = startOfTodaySql(timeZone);
  const tomorrow = `${today} + interval '1 day'`;
  const missedToday = `(cb.reason = 'missed_call' AND cb.scheduled_at >= ${today} AND cb.scheduled_at < ${tomorrow})`;
  return {
    today: `cb.done_at IS NULL AND ((cb.scheduled_at >= now() AND cb.scheduled_at < ${tomorrow}) OR ${missedToday})`,
    upcoming: `cb.done_at IS NULL AND cb.scheduled_at >= ${tomorrow}`,
    overdue: `cb.done_at IS NULL AND cb.scheduled_at < now() AND NOT ${missedToday}`,
  };
}

export interface CallbackListResult {
  callbacks: CallbackListRow[];
  /** Every tab's count, so the overdue badge is right whichever tab is open. */
  counts: Record<string, number>;
}

/**
 * `agentId: 'all'` lists every agent's callbacks - a superadmin's "All agents",
 * Jeel 2026-09-28. The route allows it only for a superadmin.
 */
export async function listCallbacks(opts: {
  agentId: number | 'all';
  when: CallbackWhen;
  /** The viewer's IANA zone, for where today ends. UTC when absent. */
  timeZone?: string;
}): Promise<CallbackListResult> {
  const WHEN_SQL = whenSql(opts.timeZone);
  const where = opts.when === 'all' ? 'true' : WHEN_SQL[opts.when];
  const everyone = opts.agentId === 'all';
  const whose = everyone ? 'true' : 'cb.agent_id = $1';
  const params = everyone ? [] : [opts.agentId];

  const { rows } = await pool.query(
    `SELECT cb.id, cb.lead_id, cb.agent_id, cb.scheduled_at, cb.done_at, cb.reason,
            u.name AS agent_name,
            l.phone, l.first_name, l.last_name, l.source,
            c.tier,
            n.body AS latest_note,
            h.id AS holder_id, h.name AS holder_name,
            mc.count AS missed_count, mc.last_at AS missed_last_at
     FROM callbacks cb
     JOIN leads l ON l.id = cb.lead_id
     LEFT JOIN users u ON u.id = cb.agent_id
     LEFT JOIN users h ON h.id = l.assigned_to AND h.is_active
     LEFT JOIN LATERAL (
       SELECT c.tier FROM conversations c
       WHERE c.lead_id = l.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1
     ) c ON true
     LEFT JOIN LATERAL (
       SELECT n.body FROM notes n
       WHERE n.lead_id = l.id ORDER BY n.created_at DESC, n.id DESC LIMIT 1
     ) n ON true
     -- The missed calls this callback stands for: from the one that booked it
     -- (ended in the same statement, so the same instant) until it was done.
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS count, max(k.started_at) AS last_at
       FROM calls k
       WHERE cb.reason = 'missed_call' AND k.lead_id = cb.lead_id
         AND k.direction = 'inbound' AND k.outcome = 'missed'
         AND k.ended_at >= cb.created_at
         AND (cb.done_at IS NULL OR k.ended_at <= cb.done_at)
     ) mc ON true
     WHERE ${whose} AND ${where}
     ORDER BY cb.scheduled_at`,
    params
  );

  const countRows = await pool.query(
    `SELECT
       count(*) FILTER (WHERE ${WHEN_SQL.today})::int    AS today,
       count(*) FILTER (WHERE ${WHEN_SQL.upcoming})::int AS upcoming,
       count(*) FILTER (WHERE ${WHEN_SQL.overdue})::int  AS overdue,
       count(*)::int AS all
     FROM callbacks cb
     WHERE ${whose}`,
    params
  );

  return {
    callbacks: rows.map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      agentId: r.agent_id,
      agentName: r.agent_name ?? '',
      scheduledAt: r.scheduled_at.toISOString(),
      doneAt: r.done_at?.toISOString() ?? null,
      reason: r.reason,
      lead: {
        phone: r.phone,
        firstName: r.first_name,
        lastName: r.last_name,
        source: r.source,
        tier: r.tier,
      },
      latestNote: r.latest_note,
      holder: r.holder_id ? { id: r.holder_id, name: r.holder_name } : null,
      missedCalls: r.missed_count > 0 ? { count: r.missed_count, lastAt: r.missed_last_at.toISOString() } : null,
    })),
    counts: countRows.rows[0],
  };
}
