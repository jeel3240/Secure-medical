/**
 * Callbacks: an agent's promise to ring a lead back at a time.
 *
 * Created from the workspace, listed on My Callbacks, rescheduled or marked
 * done from either. AGENT-WORKSPACE.md, "Endpoints"; DESIGN-PROMPT.md 5.
 */

import { pool } from './pool';

export type CallbackWhen = 'today' | 'upcoming' | 'overdue' | 'all';

export interface Callback {
  id: number;
  leadId: number;
  agentId: number;
  agentName: string;
  scheduledAt: string;
  doneAt: string | null;
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
    `SELECT cb.id, cb.lead_id, cb.agent_id, cb.scheduled_at, cb.done_at, u.name
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
  };
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
  scheduledAt: Date
): Promise<CreateResult> {
  const lead = await pool.query(`SELECT 1 FROM leads WHERE id = $1`, [leadId]);
  if (lead.rowCount === 0) return { ok: false, reason: 'lead_not_found' };

  const agent = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND is_active`, [agentId]);
  if (agent.rowCount === 0) return { ok: false, reason: 'agent_not_found' };

  const { rows } = await pool.query(
    `INSERT INTO callbacks (lead_id, agent_id, scheduled_at) VALUES ($1, $2, $3) RETURNING id`,
    [leadId, agentId, scheduledAt]
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

  await pool.query(
    `UPDATE callbacks
     SET scheduled_at = COALESCE($2, scheduled_at),
         done_at = CASE
           WHEN $3::boolean IS TRUE THEN COALESCE(done_at, now())
           WHEN $3::boolean IS FALSE THEN NULL
           ELSE done_at
         END
     WHERE id = $1`,
    [id, patch.scheduledAt ?? null, patch.done ?? null]
  );

  return { ok: true, callback: (await readCallback(id))! };
}

/**
 * The tabs on My Callbacks.
 *
 * `today` is the rest of today, not the whole day: a callback at 9am seen at
 * 3pm is overdue, and showing it under both would hide that it was missed.
 * `overdue` is everything past its time and still not done.
 */
const WHEN_SQL: Record<Exclude<CallbackWhen, 'all'>, string> = {
  today: `cb.done_at IS NULL AND cb.scheduled_at >= now() AND cb.scheduled_at < date_trunc('day', now()) + interval '1 day'`,
  upcoming: `cb.done_at IS NULL AND cb.scheduled_at >= date_trunc('day', now()) + interval '1 day'`,
  overdue: `cb.done_at IS NULL AND cb.scheduled_at < now()`,
};

export interface CallbackListResult {
  callbacks: CallbackListRow[];
  /** Every tab's count, so the overdue badge is right whichever tab is open. */
  counts: Record<string, number>;
}

export async function listCallbacks(opts: {
  agentId: number;
  when: CallbackWhen;
}): Promise<CallbackListResult> {
  const where = opts.when === 'all' ? 'true' : WHEN_SQL[opts.when];

  const { rows } = await pool.query(
    `SELECT cb.id, cb.lead_id, cb.agent_id, cb.scheduled_at, cb.done_at,
            u.name AS agent_name,
            l.phone, l.first_name, l.last_name, l.source,
            c.tier,
            n.body AS latest_note
     FROM callbacks cb
     JOIN leads l ON l.id = cb.lead_id
     LEFT JOIN users u ON u.id = cb.agent_id
     LEFT JOIN LATERAL (
       SELECT c.tier FROM conversations c
       WHERE c.lead_id = l.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1
     ) c ON true
     LEFT JOIN LATERAL (
       SELECT n.body FROM notes n
       WHERE n.lead_id = l.id ORDER BY n.created_at DESC, n.id DESC LIMIT 1
     ) n ON true
     WHERE cb.agent_id = $1 AND ${where}
     ORDER BY cb.scheduled_at`,
    [opts.agentId]
  );

  const countRows = await pool.query(
    `SELECT
       count(*) FILTER (WHERE ${WHEN_SQL.today})::int    AS today,
       count(*) FILTER (WHERE ${WHEN_SQL.upcoming})::int AS upcoming,
       count(*) FILTER (WHERE ${WHEN_SQL.overdue})::int  AS overdue,
       count(*)::int AS all
     FROM callbacks cb
     WHERE cb.agent_id = $1`,
    [opts.agentId]
  );

  return {
    callbacks: rows.map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      agentId: r.agent_id,
      agentName: r.agent_name ?? '',
      scheduledAt: r.scheduled_at.toISOString(),
      doneAt: r.done_at?.toISOString() ?? null,
      lead: {
        phone: r.phone,
        firstName: r.first_name,
        lastName: r.last_name,
        source: r.source,
        tier: r.tier,
      },
      latestNote: r.latest_note,
    })),
    counts: countRows.rows[0],
  };
}
