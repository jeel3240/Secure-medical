/**
 * A lead on hold offered to whoever comes free - T17, docs/AUTO-CALLS.md
 * "The hold line", migration 020.
 *
 * Each time a lead waiting on hold rings one person, it is a `call_offers`
 * row, written before Twilio is asked and ended once: taken, declined, rung
 * out (`missed`), the ring never completing (`failed`), the lead hanging up,
 * never heard of again (`expired`), or never rung - Twilio not taking the
 * redirect, or the call not ours to ring (`unsent`). The database holds one offer at
 * a time per lead and per person, so two triggers at once - a browser saying
 * it is free, and the hold watcher's look - can never both offer.
 */

import { pickOffer, type WaitingLead } from '../core/call-script';
import { ON_HOLD_SQL } from './auto-calls';
import { pool } from './pool';
import { FREE_SQL, JUST_OFF_A_CALL_SQL, ON_A_CALL_SQL, RINGABLE_SQL } from './presence';

/** An offer still open after this long never heard back - Twilio's ring is 20 seconds. */
export const OFFER_STALE_SECONDS = 60;

/** How an offer ended. */
export type OfferOutcome = 'taken' | 'declined' | 'missed' | 'failed' | 'hung_up' | 'expired' | 'unsent';

/** An offer just made: the lead's call, at Twilio, and who it rings. */
export interface Offer {
  offerId: number;
  callId: number;
  callSid: string;
  agentId: number;
}

/** Ends offers that never heard back - a webhook that never came. */
export async function endStaleOffers(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE call_offers SET ended_at = now(), outcome = 'expired'
     WHERE ended_at IS NULL AND offered_at < now() - ($1 || ' seconds')::interval`,
    [String(OFFER_STALE_SECONDS)]
  );
  return rowCount ?? 0;
}

/** The leads waiting on hold, longest first, with who each was offered to already. */
async function waitingLeads(): Promise<(WaitingLead & { callSid: string })[]> {
  const { rows } = await pool.query<{ id: number; twilio_call_sid: string; offered_to: number[]; live: boolean }>(
    `SELECT c.id, c.twilio_call_sid,
            COALESCE((SELECT array_agg(o.agent_id) FROM call_offers o WHERE o.call_id = c.id), '{}') AS offered_to,
            EXISTS (SELECT 1 FROM call_offers o WHERE o.call_id = c.id AND o.ended_at IS NULL) AS live
     FROM calls c
     WHERE c.direction = 'automated' AND c.twilio_call_sid IS NOT NULL AND ${ON_HOLD_SQL}
     ORDER BY c.held_at, c.id`
  );
  return rows.map((r) => ({ callId: r.id, callSid: r.twilio_call_sid, offeredTo: r.offered_to, offerLive: r.live }));
}

/** Everyone free who is not ringing with a lead from hold already. */
async function freeForOffer(): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT u.id FROM users u
     WHERE ${FREE_SQL}
       AND NOT EXISTS (SELECT 1 FROM call_offers o WHERE o.agent_id = u.id AND o.ended_at IS NULL)
     ORDER BY u.id`
  );
  return rows.map((r) => r.id);
}

/**
 * Offers the lead who has waited longest to someone free who has not had it -
 * or only to `only`, who has just come free (`pickOffer`). Written before
 * Twilio is asked, and only while that lead is still on hold. Null when there
 * is nobody to offer, or nothing to offer them.
 */
export async function startOffer(only: number | null = null): Promise<Offer | null> {
  // A second try when another trigger took the pair first.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [waiting, free] = await Promise.all([waitingLeads(), freeForOffer()]);
    const pick = pickOffer(waiting, free, only);
    if (!pick) return null;
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO call_offers (call_id, agent_id)
       SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM calls c WHERE c.id = $1 AND ${ON_HOLD_SQL})
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [pick.callId, pick.agentId]
    );
    if (rows[0]) {
      const callSid = waiting.find((w) => w.callId === pick.callId)!.callSid;
      return { offerId: rows[0].id, callId: pick.callId, callSid, agentId: pick.agentId };
    }
  }
  return null;
}

/** The offer `offerId` of the call `callId`, if it is still ringing - or null. */
export async function liveOffer(callId: number, offerId: number | null = null): Promise<{ offerId: number; agentId: number } | null> {
  const { rows } = await pool.query<{ id: number; agent_id: number }>(
    `SELECT id, agent_id FROM call_offers
     WHERE call_id = $1 AND ended_at IS NULL AND ($2::int IS NULL OR id = $2)
       AND offered_at > now() - ($3 || ' seconds')::interval`,
    [callId, offerId, String(OFFER_STALE_SECONDS)]
  );
  return rows[0] ? { offerId: rows[0].id, agentId: rows[0].agent_id } : null;
}

/** Ends the offer `offerId` of the call `callId` - once. Who it rang, or null when it had ended already. */
export async function endOffer(callId: number, offerId: number, outcome: OfferOutcome): Promise<number | null> {
  const { rows } = await pool.query<{ agent_id: number }>(
    `UPDATE call_offers SET ended_at = now(), outcome = $3
     WHERE id = $2 AND call_id = $1 AND ended_at IS NULL
     RETURNING agent_id`,
    [callId, offerId, outcome]
  );
  return rows[0]?.agent_id ?? null;
}

/**
 * Whether someone may yet take the lead on hold in the call `callId` - who
 * keeps them waiting (T16, T17): someone who takes transfers who is on a call,
 * or has just finished one and is writing its note, or is free, or is ringing
 * with another lead now. Someone who has had this lead and not taken it is not
 * coming for it, whatever they are doing.
 */
export async function someoneComing(callId: number): Promise<boolean> {
  const { rows } = await pool.query<{ coming: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM users u
       WHERE u.is_active AND u.taking_calls
         AND NOT EXISTS (SELECT 1 FROM call_offers o WHERE o.call_id = $1 AND o.agent_id = u.id)
         AND (
           ${ON_A_CALL_SQL}
           OR ${JUST_OFF_A_CALL_SQL}
           OR ${RINGABLE_SQL}
           OR EXISTS (SELECT 1 FROM call_offers o WHERE o.agent_id = u.id AND o.ended_at IS NULL)
         )
     ) AS coming`,
    [callId]
  );
  return rows[0]?.coming === true;
}
