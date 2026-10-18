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
 * every half minute, not something anyone did (AUDIT.md).
 */

import type { Querier } from './sql';

/** How long one "I'm here" holds: four times the browser's 30-second check. */
export const RINGABLE_SECONDS = 120;

/** Whether `u` (users) has a browser open that can be rung now - one part of `FREE_SQL`. */
export const RINGABLE_SQL = `(u.ringable_until IS NOT NULL AND u.ringable_until > now())`;

/**
 * Whether `u` (users) is free to take a transfer now - AUTO-CALLS.md, "Who is
 * free". The one definition: who is rung for a transfer, and how many calls
 * the robot places at once, both come from it.
 *
 * - an active account,
 * - "Taking calls" switched on (T10) - the switch decides, not the role,
 * - a browser open that can be rung (`RINGABLE_SQL`) - which also means no
 *   call, ring or note box open on its screen,
 * - and no call of theirs still going, checked here too, so a call counts the
 *   moment it starts rather than at the browser's next word. Only one started
 *   in the last 2 hours - the window a missed call's "under way" uses
 *   (`db/lead-state.ts`) - so a call whose end Twilio never reported cannot
 *   keep someone busy for good.
 */
export const FREE_SQL = `(
  u.is_active
  AND u.taking_calls
  AND ${RINGABLE_SQL}
  AND NOT EXISTS (
    SELECT 1 FROM calls oc
    WHERE oc.agent_id = u.id AND oc.outcome IS NULL AND oc.started_at > now() - interval '2 hours'
  )
)`;

/** Everyone free now, by id. */
export async function freePeople(q: Querier): Promise<number[]> {
  const { rows } = await q.query(`SELECT u.id FROM users u WHERE ${FREE_SQL} ORDER BY u.id`);
  return rows.map((r) => r.id as number);
}

/**
 * Saves what a browser says: available for the next two minutes, or not.
 * Only for an active account - a deactivated one is never rung.
 */
export async function setRingable(q: Querier, userId: number, available: boolean): Promise<void> {
  await q.query(
    `UPDATE users
     SET ringable_until = CASE WHEN $2 THEN now() + ($3 || ' seconds')::interval END
     WHERE id = $1 AND is_active`,
    [userId, available, String(RINGABLE_SECONDS)]
  );
}
