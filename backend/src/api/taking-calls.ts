/**
 * The "Taking calls" switch - T10, docs/AUTO-CALLS.md "Who is free".
 *
 * Only people who switched it on are rung for a transfer from an automated
 * call, or counted as free. A person switches it by hand (`api/calls.ts`), and
 * it goes off at every sign-in and sign-out (`api/auth/routes.ts`), so nobody
 * is rung who did not choose to be today - and when they let a transfer ring
 * out (T15c, `db/presence.ts`), so a desk left with it on stops being rung.
 *
 * Every change is one `calls.availability_changed` row (AUDIT.md), written
 * through `deps.activity` just after the change, as sign-ins and account
 * changes are: the user store is an interface the tests replace.
 */

import type { AppDeps } from './deps';
import type { TakingCallsWhy } from './users/types';

/**
 * Records that `userId` switched it to `on`. Call it only when it changed.
 * `missed_transfer` is the server's own doing, recorded with the switch-off
 * itself (`db/presence.ts`, T15c) - not through here.
 */
export async function recordTakingCalls(
  deps: Pick<AppDeps, 'activity'>,
  userId: number,
  on: boolean,
  why: Exclude<TakingCallsWhy, 'missed_transfer'>
): Promise<void> {
  await deps.activity.record({ action: 'calls.availability_changed', actorId: userId, detail: { on, why } });
}
