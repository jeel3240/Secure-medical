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
 * Matched by name rather than id because the queue endpoint returns the
 * holder's name and not their id - `QueueTag.agentName`. That is a real
 * weakness: two agents called "Sam Okonjo" would each see the other's leads as
 * their own and be allowed to click. The server still refuses the claim, so the
 * failure is a 409 rather than two agents on one lead, but the row would look
 * wrong until then. Worth returning the holder's id from the queue endpoint if
 * duplicate names ever happen; not worth a schema change before they do.
 */
export function lockHolder(lead: QueueLead, me: PublicUser | null): string | null {
  if (lead.tag.kind !== 'in_progress') return null;

  const holder = lead.tag.agentName ?? null;
  if (!holder) return null;
  if (me?.role === 'superadmin') return null;
  if (me?.name && holder === me.name) return null;

  return holder;
}
