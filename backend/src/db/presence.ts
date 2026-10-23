/**
 * Who can take a call right now - T9 and T10, docs/AUTO-CALLS.md "Who is
 * free", migrations 016 and 017.
 *
 * Each signed-in browser that can take a call says so every 30 seconds, and at
 * once when that changes: its Twilio connection is up, and nothing on its
 * screen is a call, a ring or an after-call note. The server keeps the last
 * word for two minutes, so a browser that closed, went offline or fell asleep
 * stops counting by itself. Ending the session - signing out, being
 * deactivated - clears it at once (`db/users.ts`).
 *
 * Not recorded in the activity log: it is the present moment, overwritten
 * every half minute, not something anyone did (AUDIT.md). The switch turned
 * off after a missed transfer (T15c) is recorded: it is a change to it.
 */

import type { TakingCallsWhy } from '../api/users/types';
import { activityInsertSql } from './activity';
import type { Querier } from './sql';

/** How long one "I'm here" holds: four times the browser's 30-second check. */
export const RINGABLE_SECONDS = 120;

/** Whether `u` (users) has a browser open that can be rung now - one part of `FREE_SQL`. */
export const RINGABLE_SQL = `(u.ringable_until IS NOT NULL AND u.ringable_until > now())`;

/**
 * Whether `u` (users) has a call of theirs still going - one part of
 * `FREE_SQL`. Only one started in the last 2 hours - the window a missed
 * call's "under way" uses (`db/lead-state.ts`) - so a call whose end Twilio
 * never reported cannot keep someone busy for good.
 */
export const ON_A_CALL_SQL = `EXISTS (
  SELECT 1 FROM calls oc
  WHERE oc.agent_id = u.id AND oc.outcome IS NULL AND oc.started_at > now() - interval '2 hours'
)`;

/**
 * Whether `u` (users) has just finished a call and not yet said they are free:
 * a call of theirs ended in the last two minutes, and their browser is not
 * ringable - its note box still open, most often (T17). They are free in a
 * moment, once the note is saved or skipped. Two minutes, as a browser's word
 * holds: a note box left open longer, or a browser closed on it, stops
 * counting by itself.
 */
export const JUST_OFF_A_CALL_SQL = `(NOT ${RINGABLE_SQL} AND EXISTS (
  SELECT 1 FROM calls jc
  WHERE jc.agent_id = u.id AND jc.ended_at > now() - interval '${RINGABLE_SECONDS} seconds'
))`;

/**
 * Whether `u` (users) is free to take a transfer now - AUTO-CALLS.md, "Who is
 * free". The one definition: who is rung for a transfer, and how many calls
 * the robot places at once, both come from it.
 *
 * - an active account,
 * - "Taking calls" switched on (T10) - the switch decides, not the role,
 * - a browser open that can be rung (`RINGABLE_SQL`) - which also means no
 *   call, ring or note box open on its screen,
 * - and no call of theirs still going (`ON_A_CALL_SQL`), checked here too,
 *   so a call counts the moment it starts rather than at the browser's next
 *   word.
 */
export const FREE_SQL = `(
  u.is_active
  AND u.taking_calls
  AND ${RINGABLE_SQL}
  AND NOT ${ON_A_CALL_SQL}
)`;

/**
 * Whether someone who takes transfers is on a call now, or has just finished
 * one and is writing its note - an active account, the switch on - and so will
 * be free soon: a "yes" nobody can take waits on hold for them (T16, T17,
 * AUTO-CALLS.md "The hold line"). Someone with the switch off would never be
 * rung for it.
 */
export async function someoneOnOrJustOffCall(q: Querier): Promise<boolean> {
  const { rows } = await q.query(
    `SELECT EXISTS (
       SELECT 1 FROM users u
       WHERE u.is_active AND u.taking_calls AND (${ON_A_CALL_SQL} OR ${JUST_OFF_A_CALL_SQL})
     ) AS on_call`
  );
  return rows[0]?.on_call === true;
}

/** Everyone free now, by id. */
export async function freePeople(q: Querier): Promise<number[]> {
  const { rows } = await q.query(`SELECT u.id FROM users u WHERE ${FREE_SQL} ORDER BY u.id`);
  return rows.map((r) => r.id as number);
}

/** The "Taking calls" switch as the server holds it, and why - what a browser is told. */
export interface TakingCallsState {
  takingCalls: boolean;
  takingCallsWhy: TakingCallsWhy | null;
}

/**
 * Saves what a browser says: available for the next two minutes, or not.
 * Only for an active account - a deactivated one is never rung. Answers with
 * the switch, so the browser learns when the server turned it off (T15c);
 * off for an account that is not active.
 */
export async function setRingable(q: Querier, userId: number, available: boolean): Promise<TakingCallsState> {
  const { rows } = await q.query(
    `UPDATE users
     SET ringable_until = CASE WHEN $2 THEN now() + ($3 || ' seconds')::interval END
     WHERE id = $1 AND is_active
     RETURNING taking_calls, taking_calls_why`,
    [userId, available, String(RINGABLE_SECONDS)]
  );
  const row = rows[0] as { taking_calls: boolean; taking_calls_why: TakingCallsWhy | null } | undefined;
  return { takingCalls: row?.taking_calls ?? false, takingCallsWhy: row?.taking_calls_why ?? null };
}

/**
 * `userId` let a transfer's ring run its course, untouched - T15c,
 * AUTO-CALLS.md "Who is free": their "Taking calls" switch goes off, so a desk
 * left with it on stops being rung, and their screen says why.
 *
 * Only if it is still on, the account active, and they are not on a call by
 * now - someone who started a call of their own while it rang keeps it on.
 * Their browser's word is not asked: the ring itself made it busy. One
 * statement with its `calls.availability_changed` record - the system's doing,
 * so no actor; the person is its subject, the call in `detail`. True when it
 * was switched off.
 */
export async function switchOffAfterMissedRing(q: Querier, userId: number, callId: number): Promise<boolean> {
  const { rows } = await q.query(
    `WITH off AS (
       UPDATE users u
       SET taking_calls = false, taking_calls_at = now(), taking_calls_why = 'missed_transfer', updated_at = now()
       WHERE u.id = $1 AND u.taking_calls AND u.is_active AND NOT ${ON_A_CALL_SQL}
       RETURNING u.id
     )
     ${activityInsertSql}
     SELECT NULL, 'calls.availability_changed', NULL, off.id,
            jsonb_build_object('on', false, 'why', 'missed_transfer', 'callId', $2::int)
     FROM off
     RETURNING subject_user_id`,
    [userId, callId]
  );
  return rows.length > 0;
}
