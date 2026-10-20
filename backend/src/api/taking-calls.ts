/**
 * The "Taking calls" switch - T10, docs/AUTO-CALLS.md "Who is free".
 *
 * Only people who switched it on are rung for a transfer from an automated
 * call, or counted as free. A person switches it by hand (`api/calls.ts`), and
 * it goes off at every sign-in and sign-out (`api/auth/routes.ts`), so nobody
 * is rung who did not choose to be today.
 *
 * Every change is one `calls.availability_changed` row (AUDIT.md), written
 * through `deps.activity` just after the change, as sign-ins and account
 * changes are: the user store is an interface the tests replace.
 */

import type { AppDeps } from './deps';

/** Why it changed. `missed_transfer` joins these with T15c. */
export type TakingCallsWhy = 'by_hand' | 'sign_in' | 'sign_out';

/** Records that `userId` switched it to `on`. Call it only when it changed. */
export async function recordTakingCalls(
  deps: Pick<AppDeps, 'activity'>,
  userId: number,
  on: boolean,
  why: TakingCallsWhy
): Promise<void> {
  await deps.activity.record({ action: 'calls.availability_changed', actorId: userId, detail: { on, why } });
}
