/**
 * The robot placing its calls by itself - T20, docs/AUTO-CALLS.md "When a lead
 * is called" and "Traffic". One look on each of the worker's ticks (every 30
 * seconds), while automated calls are on and calling is set up:
 *
 * 1. The robot's calls that never reached Twilio are closed
 *    (`closeUnplacedCalls`) - whatever the hour.
 * 2. Outside the calling hours, nothing more.
 * 3. The room: people free to take a "yes", less the robot's calls still
 *    going with nobody on them; none while a lead waits on hold
 *    (`callsToPlace`).
 * 4. The leads due, oldest first, up to the room (`leadsToCall`), each placed
 *    as from T12 (`placeAutoCall`), one after another.
 *
 * Steps 3 and 4 hold the dial lock (`withDialLock`): a second worker looks
 * nothing up while one is dialling.
 */

import { callsToPlace, insideCallHours, type CallHours, type DialRoom } from '../core/auto-dial';
import type { PlaceAutoCallResult } from './place-auto-call';

/** What one look reads and does - the database and Twilio, replaced in tests. */
export interface DialDeps {
  closeUnplacedCalls: () => Promise<number>;
  autoCallsSince: () => Promise<Date>;
  readCallHours: () => Promise<CallHours>;
  dialRoom: () => Promise<DialRoom>;
  leadsToCall: (opts: { now: Date; since: Date; waitMinutes: number; limit: number }) => Promise<number[]>;
  placeAutoCall: (leadId: number) => Promise<PlaceAutoCallResult>;
  withDialLock: <T>(look: () => Promise<T>) => Promise<T | null>;
}

/** What a look did - logged when anything happened. */
export interface DialLook {
  /** Calls that never reached Twilio, closed. */
  closed: number;
  inside: boolean;
  /** How many calls there was room for. */
  room: number;
  /** Leads due, up to the room. */
  due: number;
  placed: number;
  refused: number;
  failed: number;
  unconfirmed: number;
  /** Another worker was dialling. */
  locked: boolean;
}

export async function dialDueLeads(deps: DialDeps, now = new Date()): Promise<DialLook> {
  const look: DialLook = { closed: 0, inside: false, room: 0, due: 0, placed: 0, refused: 0, failed: 0, unconfirmed: 0, locked: false };
  look.closed = await deps.closeUnplacedCalls();
  // Written the first time this looks with automated calls on - inside the
  // hours or not - so leads that arrived before it are never called.
  const since = await deps.autoCallsSince();
  const hours = await deps.readCallHours();
  look.inside = insideCallHours(now, hours);
  if (!look.inside) return look;

  const dialled = await deps.withDialLock(async () => {
    look.room = callsToPlace(await deps.dialRoom());
    if (look.room === 0) return;
    const leads = await deps.leadsToCall({ now, since, waitMinutes: hours.waitMinutes, limit: look.room });
    look.due = leads.length;
    for (const leadId of leads) {
      const result = await deps.placeAutoCall(leadId);
      look[result.kind] += 1;
    }
  });
  if (dialled === null) look.locked = true;
  return look;
}

/** Whether a look is worth a log line: something was closed, due, or another worker held the lock. */
export function worthLogging(look: DialLook): boolean {
  return look.closed > 0 || look.due > 0 || look.locked;
}
