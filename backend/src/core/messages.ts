/**
 * Rendering outbound SMS copy. Pure: no database, no network.
 *
 * Copy lives in `settings` so a superadmin can edit it, and may contain
 * `{first_name}`. Rendering is here rather than at the send site so the state
 * machine and the poller produce identical text from the same template.
 */

/** Used when EZ Texting gave us no first name, which is common. */
export const NAME_FALLBACK = 'there';

/**
 * One SMS segment is 160 characters on Express delivery and 130 on Standard.
 * Past that a message splits and is billed twice, so a long first name must not
 * be what pushes it over.
 */
export const SEGMENT_LIMIT = 160;

export interface RenderedMessage {
  text: string;
  /** True when the name was dropped to keep the message inside one segment. */
  nameDropped: boolean;
}

function fill(template: string, name: string): string {
  return template.replace(/\{first_name\}/g, name);
}

/**
 * Substitutes the lead's first name, falling back to "there" when there is
 * none. If the result would run past one segment, it re-renders with the
 * fallback: a long name costs a second segment on every message, and the
 * greeting reads fine without it.
 */
export function renderMessage(
  template: string,
  firstName: string | null | undefined,
  limit: number = SEGMENT_LIMIT
): RenderedMessage {
  const name = firstName?.trim() ? firstName.trim() : NAME_FALLBACK;
  const withName = fill(template, name);

  if (withName.length <= limit || name === NAME_FALLBACK) {
    return { text: withName, nameDropped: false };
  }

  const withFallback = fill(template, NAME_FALLBACK);
  return withFallback.length < withName.length
    ? { text: withFallback, nameDropped: true }
    : { text: withName, nameDropped: false };
}
