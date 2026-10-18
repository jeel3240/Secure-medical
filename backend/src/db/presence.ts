/**
 * Who can take a call right now - T9, docs/AUTO-CALLS.md "Who is free",
 * migration 016.
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

/**
 * Whether `u` (users) can be rung now. T10 adds the "Taking calls" switch and
 * a call already under way to make the full "free".
 */
export const RINGABLE_SQL = `(u.ringable_until IS NOT NULL AND u.ringable_until > now())`;

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
