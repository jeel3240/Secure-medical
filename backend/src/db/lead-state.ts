/**
 * Where a lead stands once agents are involved: SQL fragments shared by the
 * queue (`db/queue.ts`) and Admin > Leads (`db/leads.ts`), so the two screens
 * cannot disagree about whether a lead is finished.
 *
 * Jeel, 2026-09-28. Until then a lead's status described only its SMS
 * conversation. A lead that finished the questions read "Completed"
 * forever - untouched, called five times or finished alike - and a finished
 * lead went back into the queue at the top. Two states were added, both
 * computed from what agents have already recorded, nothing stored:
 *
 * - **Worked** - an agent has done something with the lead.
 * - **Closed** - an agent pressed Closed on it.
 *
 * Every fragment expects the lead as `l`. `ADMIN-LEADS.md` and `QUEUE.md` say
 * how each screen uses them.
 */

import { CLOSING_DISPOSITIONS } from '../core/dispositions';

/**
 * Safe to inline: the values come from a constant in this codebase, never
 * from a request, and each is checked to be a plain word.
 */
const closingList = CLOSING_DISPOSITIONS.map((value) => {
  if (!/^[a-z_]+$/.test(value)) throw new Error(`Unexpected disposition: ${value}`);
  return `'${value}'`;
}).join(', ');

/**
 * A missed call nobody has returned - Jeel, 2026-10-01. The lead rang our
 * number and no agent answered, and since then nobody has called them, spoken
 * to them, or texted them themselves.
 *
 * It needs a person, so it puts the lead in the queue and reopens a closed one,
 * the way an unread text does. Returning the call - or an agent texting them -
 * is what clears it; nothing has to be marked.
 *
 * The automated "we will call you back" text does not clear it: that text is
 * the promise, not the call back.
 *
 * **Nor does an automated call** (T4, 2026-10-18; `AUTO-CALLS.md`) - the
 * server's scripted call is not a person getting back to them. Once a person
 * takes its transfer it carries their `agent_id`, and then it counts like any
 * call an agent was on. So "a call that returns it" is an agent's own call, or
 * any call with a person on it - answered, or under way.
 *
 * **A call under way counts as returning it** - found on the first real
 * answered call, 2026-10-01: the agent was talking to the lead under a banner
 * saying nobody had answered them, because a call has no outcome until it
 * ends. If that call ends unanswered it is a missed call itself, and the flag
 * is back. Only a recent one counts, so a row whose end Twilio never reported
 * cannot hide a missed call for good.
 *
 * **An outcome settles it too** - found in the doc review the same day. An
 * agent who saves Closed or DNC after the missed call has decided what happens
 * to the lead; without this the lead stayed in the queue as Missed call and
 * read Working, while its callback was already finished by the outcome. The
 * rule since 2026-09-29: a closed lead leaves the queue.
 *
 * **A text EZ Texting refused does not count.** It never reached the lead, so
 * nobody has got back to them.
 *
 * "Nobody has got back to them" is `nobodyGotBackSince`, shared with the
 * missed "yes" below (T22) - one rule for both.
 */
export const MISSED_CALL_SQL = `(
  EXISTS (
    SELECT 1 FROM calls mc
    WHERE mc.lead_id = l.id AND mc.direction = 'inbound' AND mc.outcome = 'missed'
      AND ${nobodyGotBackSince('mc')}
  )
)`;

/**
 * Since the call `call` (a `calls` alias of the enclosing query), no person
 * has got back to the lead: no agent's call, no call a person was on -
 * answered, or under way in the last two hours - no text of an agent's that
 * EZ Texting took, and no outcome saved. `MISSED_CALL_SQL` above says why each
 * counts.
 *
 * A function so the rule is written once: a missed call and a missed "yes"
 * are both a lead waiting on us, cleared the same way.
 *
 * **It names the call's lead, never `l`** (T22): its only tie to the lead
 * being asked about is then the caller's `<call>.lead_id = l.id`, so Postgres
 * can work out every such call once per statement - a set it looks each lead
 * up in - instead of once per lead. The queue asks it of every lead, every
 * five seconds: `QUEUE.md`, "How fast it is".
 */
function nobodyGotBackSince(call: string): string {
  return `NOT EXISTS (
        SELECT 1 FROM calls rc
        WHERE rc.lead_id = ${call}.lead_id AND rc.id > ${call}.id
          AND (
            rc.direction = 'outbound'
            OR (
              rc.agent_id IS NOT NULL
              AND (rc.outcome = 'answered' OR (rc.outcome IS NULL AND rc.started_at > now() - interval '2 hours'))
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM messages am
        WHERE am.lead_id = ${call}.lead_id AND am.sent_by IS NOT NULL AND am.created_at > ${call}.created_at
          AND am.delivery_status IS DISTINCT FROM 'failed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM dispositions od
        WHERE od.lead_id = ${call}.lead_id AND od.created_at > ${call}.created_at
      )`;
}

/**
 * A missed "yes" - T22, `AUTO-CALLS.md`. The lead said yes on the robot's
 * call, nobody took the transfer, and they heard "An agent will call you back
 * shortly" (`script_result = 'transfer_missed'`). Since then nobody has got
 * back to them - the same rule as a missed call: an agent calls them, texts
 * them, answers when they ring, or saves an outcome.
 *
 * A robot call that ended any other way - not interested, voicemail, no
 * answer - is not a lead waiting on us, and puts nobody in the queue.
 *
 * `MISSED_YES_SQL` says whether the lead has one; `MISSED_YES_AT_SQL` when
 * that call was made, or null - what the queue sorts on, the longest waiting
 * first. One automated call per lead (`calls_one_automated_per_lead`); the
 * LIMIT keeps it one value should a second try ever be allowed.
 */
const MISSED_YES_CALL = `yc.direction = 'automated' AND yc.script_result = 'transfer_missed'
    AND ${nobodyGotBackSince('yc')}`;

export const MISSED_YES_SQL = `(
  EXISTS (SELECT 1 FROM calls yc WHERE yc.lead_id = l.id AND ${MISSED_YES_CALL})
)`;

export const MISSED_YES_AT_SQL = `(
  SELECT yc.created_at FROM calls yc
  WHERE yc.lead_id = l.id AND ${MISSED_YES_CALL}
  ORDER BY yc.id
  LIMIT 1
)`;

/**
 * Closed: the newest disposition is `closed` (or a retired value that meant
 * the same - `core/dispositions.ts`), and nothing has reopened it since. Two
 * things reopen a closed lead:
 *
 * - **The lead writes to us.** A person has to read it, so it returns to the
 *   queue as an inbound reply - `has_unread_inbound`, STATE-MACHINE.md rule 2.
 *   Once read, it is closed again, without anyone pressing Closed twice.
 * - **The lead rings us and nobody answers** - `MISSED_CALL_SQL`, 2026-10-01.
 *   Closed again once the call is returned.
 * - **An agent books a callback after closing it** - and it is not done yet. A
 *   closed lead who texts back "actually, call me Friday" has to stay in
 *   reach, and a callback is the action that says "this is not finished".
 *   Until 2026-09-28 an agent reopened a lead by marking it Interested; that
 *   disposition was retired.
 * - **An agent picks it up again** - Jeel, 2026-09-29. Whoever holds a lead is
 *   working it, whatever was saved before. Without this, a closed lead that
 *   texted and was picked up read Closed again the moment the reply was read:
 *   Admin > Leads said Closed while the queue said "Working - Maya", and the
 *   workspace showed Closed already selected to the agent holding it. Saving
 *   an outcome releases the lead, so it reads Closed again from then on.
 *
 * Written as EXISTS rather than `latest IN (...)`: a lead with no disposition
 * has a NULL newest one, `NULL IN (...)` is NULL rather than false, and an
 * earlier version dropped every lead nobody had closed from the queue. The
 * live check caught it.
 */
export const CLOSED_SQL = `(
  EXISTS (
    SELECT 1
    FROM (
      SELECT cd.value, cd.created_at FROM dispositions cd
      WHERE cd.lead_id = l.id
      ORDER BY cd.created_at DESC, cd.id DESC
      LIMIT 1
    ) newest
    WHERE newest.value IN (${closingList})
      AND NOT EXISTS (
        SELECT 1 FROM callbacks rc
        WHERE rc.lead_id = l.id AND rc.done_at IS NULL AND rc.created_at > newest.created_at
      )
  )
  AND NOT l.has_unread_inbound
  AND NOT ${MISSED_CALL_SQL}
  AND NOT EXISTS (SELECT 1 FROM users hu WHERE hu.id = l.assigned_to AND hu.is_active)
)`;

/**
 * Worked: an agent holds the lead now, or has left a trace on it - a note, a
 * callback, a disposition, a call, or an SMS of their own.
 *
 * Picking a lead and putting it back without doing anything leaves no trace -
 * releasing clears `assigned_to` and `assigned_at` - so that lead is not
 * worked. That is deliberate: nothing happened to it.
 */
export const WORKED_SQL = `(
  EXISTS (SELECT 1 FROM users wu WHERE wu.id = l.assigned_to AND wu.is_active)
  OR EXISTS (SELECT 1 FROM notes wn WHERE wn.lead_id = l.id)
  OR EXISTS (SELECT 1 FROM callbacks wc WHERE wc.lead_id = l.id)
  OR EXISTS (SELECT 1 FROM dispositions wd WHERE wd.lead_id = l.id)
  -- A call an agent placed or answered. A missed incoming call is the lead's
  -- doing, not an agent's work; nor is an automated call nobody took (T4) -
  -- answered by the lead, it still had no person on it.
  OR EXISTS (
    SELECT 1 FROM calls wk
    WHERE wk.lead_id = l.id
      AND (wk.direction = 'outbound' OR (wk.outcome = 'answered' AND wk.agent_id IS NOT NULL))
  )
  OR EXISTS (SELECT 1 FROM messages wm WHERE wm.lead_id = l.id AND wm.sent_by IS NOT NULL)
)`;
