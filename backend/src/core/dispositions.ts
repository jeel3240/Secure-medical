/**
 * The eight dispositions, which one blocks the number, and which ones close
 * the lead.
 *
 * Kept apart from `db/dispositions.ts` because this list is pure: the route
 * validates against it, the frontend will render it, and a test can import it
 * without pulling in the pool - and therefore src/config, which exits the
 * process when an env var is missing.
 *
 * DESIGN-PROMPT.md section 3, right column.
 */

/**
 * In the order the segmented control shows them.
 *
 * `dispositions.value` is plain TEXT with no check constraint, so this list is
 * the only thing keeping the column to a known set. Adding one means adding it
 * here; the timeline and the reports read whatever is stored.
 */
export const DISPOSITIONS = [
  'sold',
  'interested',
  'callback_set',
  'no_answer',
  'voicemail',
  'not_interested',
  'wrong_number',
  'dnc',
] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

/** The one that also blocks the number. */
export const DNC_DISPOSITION: Disposition = 'dnc';

/**
 * The outcomes that finish a lead - Jeel, 2026-09-28. When a lead's newest
 * disposition is one of these, it is Closed on Admin > Leads and leaves the
 * queue (`db/lead-state.ts`). The rest mean "try again" and keep it there.
 *
 * `dnc` is not in the list because it needs no help: it blocks the number,
 * and a blocked number is Opted out and out of the queue already.
 *
 * `sold` was added the same day. Before it there was no way to record a sale,
 * so a sold lead went back into the queue as a fresh, high-scoring lead.
 */
export const CLOSING_DISPOSITIONS: readonly Disposition[] = ['sold', 'not_interested', 'wrong_number'];

export function isDisposition(value: string): value is Disposition {
  return (DISPOSITIONS as readonly string[]).includes(value);
}
