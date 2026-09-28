/**
 * Where a lead stands once agents are involved: SQL fragments shared by the
 * queue (`db/queue.ts`) and Admin > Leads (`db/leads.ts`), so the two screens
 * cannot disagree about whether a lead is finished.
 *
 * Jeel, 2026-09-28. Until then a lead's status described only its SMS
 * conversation. A lead that answered all three questions read "Completed"
 * forever - untouched, called five times or sold alike - and a sold lead went
 * back into the queue at the top. Two states were added, both computed from
 * what agents have already recorded, nothing stored:
 *
 * - **Worked** - an agent has done something with the lead.
 * - **Closed** - an agent has recorded an outcome that finishes it.
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

/** The lead's newest disposition, or NULL when it has none. */
export const LATEST_DISPOSITION_SQL = `(
  SELECT ld.value FROM dispositions ld
  WHERE ld.lead_id = l.id
  ORDER BY ld.created_at DESC, ld.id DESC
  LIMIT 1
)`;

/**
 * Closed: the newest disposition is Sold, Not interested or Wrong number, and
 * the lead has not written to us since.
 *
 * The newest one decides, so a lead closed and later marked Interested by
 * another agent is open again. And a closed lead who texts back is no longer
 * closed: a person has to read what they sent, so it returns to the queue as
 * an inbound reply - `has_unread_inbound`, STATE-MACHINE.md rule 2.
 *
 * The COALESCE matters. A lead with no disposition has a NULL newest one, and
 * `NULL IN (...)` is NULL, not false - so `NOT closed` was NULL too and the
 * queue silently dropped every lead nobody had dispositioned yet. The live
 * check caught it.
 */
export const CLOSED_SQL = `(
  COALESCE(${LATEST_DISPOSITION_SQL} IN (${closingList}), false)
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
