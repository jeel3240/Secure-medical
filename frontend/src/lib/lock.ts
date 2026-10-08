import type { QueueLead } from '../api/leads';
import type { PublicUser } from '../api/types';

/**
 * The one-agent lock, as the screens see it.
 *
 * Phase 3 task 16. The rule itself is enforced on the server - `db/claims.ts`,
 * and no screen is trusted with it - but the queue has to decide which rows to
 * mute before anyone clicks, so the same decision is made here too.
 *
 * Returns the name of the agent holding the lead, or null when the caller may
 * open it.
 *
 * Three ways a row is *not* locked, each for its own reason:
 *
 * - **Nobody holds it.** The usual case.
 * - **You hold it.** Reopening a lead you are already working is the normal way
 *   back into it; locking an agent out of their own claim would strand them.
 * - **You are a superadmin.** They can force-release a claim, and they need to
 *   see what an agent is stuck on. `AGENT-WORKSPACE.md`.
 *
 * Matched by the holder's **id**, `QueueTag.agentId`. Until 2026-09-28 the
 * queue returned only the name and this compared names, so two agents called
 * "Sam Okonjo" each saw the other's lead as their own "Resume" row and got a
 * 409 on clicking it. Found in review.
 */
export function lockHolder(lead: QueueLead, me: PublicUser | null): string | null {
  return rowAction(lead, me) === 'locked' ? lead.tag?.agentName ?? null : null;
}

/**
 * What the row's action button may actually do, which is not the same question
 * as whether the row is locked.
 *
 * `Pick` claims the lead. On a lead someone already holds, the server refuses
 * that claim, so offering it would be a button that always fails - which is
 * what happened when one label covered every row:
 *
 * - **pick** - nobody holds it. Claim it and work it.
 * - **resume** - you hold it. Re-claiming your own lead succeeds, but calling
 *   it "Pick" implies taking something you already have.
 * - **view** - someone else holds it and you are a superadmin. You may look -
 *   that is why the row is not muted - but you may not claim it, so the action
 *   opens the workspace read-only. Taking it off the
 *   agent is a release, a separate and deliberate act.
 * - **locked** - someone else holds it and you are an agent. No action at all.
 *
 * Your own claim is checked before the superadmin rule, so a superadmin working
 * their own lead is offered `resume`, not `view`.
 */
export type RowAction = 'pick' | 'resume' | 'view' | 'locked';

export function rowAction(lead: QueueLead, me: PublicUser | null): RowAction {
  if (lead.tag?.kind !== 'working') return 'pick';

  const holderId = lead.tag.agentId ?? null;
  if (holderId === null) return 'pick';
  if (me && holderId === me.id) return 'resume';
  if (me?.role === 'superadmin') return 'view';

  return 'locked';
}

/**
 * Whether the viewer may let a held lead go - the Release button on the lead's
 * page. The holder may; so may a superadmin, for anyone's, which is the way
 * out of a lead locked to an agent who has gone home. Nobody else, and there
 * is nothing to release on a lead nobody holds. The server decides for real
 * (`db/claims.ts`); this only decides whether to offer the button.
 */
export function mayRelease(holder: { id: number } | null, me: PublicUser | null): boolean {
  if (!holder || !me) return false;
  return holder.id === me.id || me.role === 'superadmin';
}

