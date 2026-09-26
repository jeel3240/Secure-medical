/**
 * The seven dispositions, and which one blocks the number.
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
 * the only thing keeping the column to a known set. Adding an eighth means
 * adding it here; the timeline and the reports read whatever is stored.
 */
export const DISPOSITIONS = [
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

export function isDisposition(value: string): value is Disposition {
  return (DISPOSITIONS as readonly string[]).includes(value);
}
