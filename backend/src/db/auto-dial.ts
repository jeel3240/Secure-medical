/**
 * The robot placing its calls - T20, docs/AUTO-CALLS.md "When a lead is
 * called" and "Traffic": who is called next, how much room there is, and the
 * calls that never reached Twilio. The worker's job is `worker/auto-calls.ts`;
 * each call is placed by `worker/place-auto-call.ts`, as from T12.
 */

import type { DialRoom } from '../core/auto-dial';
import { activityInsertSql } from './activity';
import { ON_HOLD_SQL } from './auto-calls';
import { WORKED_SQL } from './lead-state';
import { pool } from './pool';
import { FREE_SQL } from './presence';

/**
 * How long a call of the robot's counts as still going with nobody on it, for
 * the room - and how long a row that never reached Twilio is left before it is
 * closed. Ten minutes: far longer than any call that is ringing or asking.
 */
export const UNDER_WAY_MINUTES = 10;

/**
 * When automated calls were first switched on - `settings.auto_calls_since`,
 * written the first time the worker looks with them on, and never again: only
 * leads that arrive after it are ever called, never the backlog. The row is
 * its own record - written once, never overwritten.
 */
export async function autoCallsSince(): Promise<Date> {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('auto_calls_since', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     ON CONFLICT (key) DO NOTHING`
  );
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'auto_calls_since'`);
  return new Date(rows[0].value);
}

/** Who can take a "yes" now, against the robot's calls still going - `callsToPlace`. */
export async function dialRoom(): Promise<DialRoom> {
  const { rows } = await pool.query<{ free: number; underway: number; on_hold: boolean }>(
    `SELECT (SELECT count(*)::int FROM users u WHERE ${FREE_SQL}) AS free,
            (SELECT count(*)::int FROM calls c
             WHERE c.direction = 'automated' AND c.outcome IS NULL AND c.agent_id IS NULL
               AND c.started_at > now() - interval '${UNDER_WAY_MINUTES} minutes') AS underway,
            EXISTS (SELECT 1 FROM calls c WHERE ${ON_HOLD_SQL}) AS on_hold`
  );
  return { free: rows[0].free, underway: rows[0].underway, onHold: rows[0].on_hold };
}

/**
 * The leads to call now, oldest first - "When a lead is called". A lead is
 * called when:
 *
 * - it arrived after `since`, when automated calls were first switched on;
 * - its first text went out at least `waitMinutes` ago (`question_sent_at` of
 *   its conversation), and that conversation is still open - not answered,
 *   expired or stopped;
 * - it has not replied - no text from it, and no call from it either: either
 *   is a lead reaching us, and a person's to deal with;
 * - nobody holds it, and nobody has worked it (`WORKED_SQL`: a note, a
 *   callback, an outcome - Closed among them - an agent's call or text);
 * - its number is not blocked, and the robot has never called it.
 *
 * Oldest first, by when the first text went out: a lead whose hour ended
 * outside the calling hours is called at their start, before newer ones.
 * `only`, outside production, is the test numbers - the only ones looked at,
 * so a laptop's fake leads are never even tried. `now` is a parameter so the
 * live check can stand at any time.
 */
export async function leadsToCall(opts: {
  now: Date;
  since: Date;
  waitMinutes: number;
  only: readonly string[] | null;
  limit: number;
}): Promise<number[]> {
  if (opts.limit <= 0) return [];
  const { rows } = await pool.query<{ id: number }>(
    `SELECT l.id
     FROM leads l
     JOIN LATERAL (
       SELECT c.status, c.question_sent_at FROM conversations c
       WHERE c.lead_id = l.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1
     ) c ON true
     WHERE l.created_at > $2
       AND c.status = 'open'
       AND c.question_sent_at <= $1::timestamptz - ($3 || ' minutes')::interval
       AND l.assigned_to IS NULL
       AND NOT ${WORKED_SQL}
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.lead_id = l.id AND m.direction = 'inbound')
       AND NOT EXISTS (SELECT 1 FROM calls ic WHERE ic.lead_id = l.id AND ic.direction = 'inbound')
       AND NOT EXISTS (SELECT 1 FROM calls ac WHERE ac.lead_id = l.id AND ac.direction = 'automated')
       AND NOT EXISTS (SELECT 1 FROM dnc_list d WHERE d.phone = l.phone AND d.released_at IS NULL)
       AND ($4::text[] IS NULL OR l.phone = ANY($4::text[]))
     ORDER BY c.question_sent_at, l.id
     LIMIT $5`,
    [opts.now, opts.since, String(opts.waitMinutes), opts.only, opts.limit]
  );
  return rows.map((r) => r.id);
}

/**
 * Closes the robot's calls that never reached Twilio - T12 left a row whose
 * request got no answer, in case the call went out anyway; when no webhook has
 * named it in `UNDER_WAY_MINUTES`, it did not. Ended as `failed`,
 * `unanswered`, with its `call.ended` record, so it is not "under way" for
 * ever. Returns how many.
 */
export async function closeUnplacedCalls(): Promise<number> {
  const { rowCount } = await pool.query(
    `WITH closed AS (
       UPDATE calls SET outcome = 'failed', duration_sec = 0, ended_at = now(), script_result = 'unanswered'
       WHERE direction = 'automated' AND twilio_call_sid IS NULL AND ended_at IS NULL
         AND started_at < now() - interval '${UNDER_WAY_MINUTES} minutes'
       RETURNING id, lead_id
     )
     ${activityInsertSql}
     SELECT NULL::int, 'call.ended', lead_id, NULL::int,
            jsonb_build_object('callId', id, 'direction', 'automated', 'outcome', 'failed', 'reason', 'never_reached_twilio')
     FROM closed`
  );
  return rowCount ?? 0;
}

/** The advisory lock that keeps the robot to one look at a time, whatever runs it. */
const DIAL_LOCK = 'auto_dial';

/**
 * Runs `look` holding the dial lock, or not at all - null - when another worker
 * holds it: two looks at once would each see the same room and the same leads.
 * (The same lead is never called twice regardless - `startAutomatedCall` locks
 * it, and the database allows one automated call per lead.)
 */
export async function withDialLock<T>(look: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [DIAL_LOCK]);
    if (!rows[0].locked) return null;
    try {
      return await look();
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [DIAL_LOCK]);
    }
  } finally {
    client.release();
  }
}
