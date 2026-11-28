/**
 * The dispositions an agent can record: Closed and Do Not Contact.
 *
 * Kept apart from `db/dispositions.ts` because this list is pure: the route
 * validates against it, the frontend renders it, and a test can import it
 * without pulling in the pool - and therefore src/config, which exits the
 * process when an env var is missing.
 *
 * **Two, since 2026-09-28 - Jeel.** There were eight: Interested, Callback
 * set, No answer, Voicemail, Not interested, Wrong number and DNC, and Sold
 * for part of that day. The requirement asks for none of them. Each recorded
 * one attempt rather than where the lead stands, and said something the screen
 * already has: a booked callback is its own record, and "no answer" or "left a
 * voicemail" is a note - and, from Phase 4, a row in `calls`. What an agent
 * has to tell the app is whether the lead is finished (Closed) or must never
 * be contacted again (DNC).
 *
 * DESIGN-PROMPT.md section 3, right column; AGENT-WORKSPACE.md, "Dispositions".
 */

/**
 * What the route accepts, in the order the workspace shows them.
 *
 * `dispositions.value` is plain TEXT with no check constraint, so this list is
 * the only thing keeping new rows to a known set. Changing it needs no
 * migration.
 */
export const DISPOSITIONS = ['closed', 'dnc'] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

/**
 * Values that may be in the table from before 2026-09-28 and are never written
 * again. Rows holding them stay - the table is append-only history - and the
 * screens still name them: the words are the frontend's (`frontend/src/api/
 * workspace.ts`). Here they type `CLOSING_DISPOSITIONS`, so it can hold no value
 * the table never had (review Q5, 2026-11-23).
 */
export const RETIRED_DISPOSITIONS = [
  'sold',
  'interested',
  'callback_set',
  'no_answer',
  'voicemail',
  'not_interested',
  'wrong_number',
] as const;

export type RetiredDisposition = (typeof RETIRED_DISPOSITIONS)[number];

/** The one that also blocks the number. */
export const DNC_DISPOSITION: Disposition = 'dnc';

/**
 * The values that finish a lead: when a lead's newest disposition is one of
 * these, it is Closed on Admin > Leads and leaves the queue
 * (`db/lead-state.ts`).
 *
 * `closed` is the only one written now. The three retired values that meant
 * the same thing - a sale, not interested, a wrong number - still count, so a
 * lead closed under the old list does not reopen.
 *
 * `dnc` is not here because it needs no help: it blocks the number, and a
 * blocked number is Opted out and out of the queue already.
 */
export const CLOSING_DISPOSITIONS: readonly (Disposition | RetiredDisposition)[] = ['closed', 'sold', 'not_interested', 'wrong_number'];

export function isDisposition(value: string): value is Disposition {
  return (DISPOSITIONS as readonly string[]).includes(value);
}

/**
 * Why a lead was closed - asked when Closed is pressed (B04, Jeel 2026-11-27),
 * saved in `dispositions.reason`, in the order the popup shows them. On Closed
 * only; the database refuses one anywhere else (`dispositions_reason_only_closed`)
 * and any other word (`dispositions_reason_known`).
 *
 * New values in their own column. Three of the retired outcomes have the same
 * names (`RETIRED_DISPOSITIONS`); those are `value`s from before 2026-09-28 and
 * stay as they are.
 */
export const CLOSE_REASONS = ['sold', 'not_interested', 'wrong_number'] as const;

export type CloseReason = (typeof CLOSE_REASONS)[number];

export function isCloseReason(value: string): value is CloseReason {
  return (CLOSE_REASONS as readonly string[]).includes(value);
}

/**
 * A sale, as Admin > Overview counts it (B05): a Closed whose reason is
 * `sold`, or the retired `sold` outcome from before 2026-09-28, which meant
 * the same. Typed against both lists, so neither can name a value they lack.
 */
export const SOLD_REASON: CloseReason = 'sold';
export const RETIRED_SOLD: RetiredDisposition = 'sold';
