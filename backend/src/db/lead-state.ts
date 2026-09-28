/**
 * Where a lead stands once agents are involved: SQL fragments shared by the
 * queue (`db/queue.ts`) and Admin > Leads (`db/leads.ts`), so the two screens
 * cannot disagree about whether a lead is finished.
 *
 * Jeel, 2026-09-28. Until then a lead's status described only its SMS
 * conversation. A lead that answered all three questions read "Completed"
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
 * Closed: the newest disposition is `closed` (or a retired value that meant
 * the same - `core/dispositions.ts`), and nothing has reopened it since. Two
 * things reopen a closed lead:
 *
 * - **The lead writes to us.** A person has to read it, so it returns to the
 *   queue as an inbound reply - `has_unread_inbound`, STATE-MACHINE.md rule 2.
 *   Once read, it is closed again, without anyone pressing Closed twice.
 * - **An agent books a callback after closing it** - and it is not done yet. A
 *   closed lead who texts back "actually, call me Friday" has to stay in
 *   reach, and a callback is the action that says "this is not finished".
 *   Until 2026-09-28 an agent reopened a lead by marking it Interested; that
 *   disposition was retired.
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
  OR EXISTS (SELECT 1 FROM calls wk WHERE wk.lead_id = l.id)
  OR EXISTS (SELECT 1 FROM messages wm WHERE wm.lead_id = l.id AND wm.sent_by IS NOT NULL)
)`;
