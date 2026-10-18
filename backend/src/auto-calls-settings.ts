/**
 * The settings for automated calls, docs/AUTO-CALLS.md: whether the server
 * places them (`AUTO_CALLS`), and outside production which numbers it may ring
 * (`AUTO_CALL_TEST_NUMBERS`).
 */

/**
 * Whether the server places automated calls - `AUTO_CALLS`, docs/AUTO-CALLS.md.
 *
 * Off unless it says exactly `on`: production gets each automated-calling
 * ticket with this off, and is switched on by hand once all of them are in.
 * Anything else it might say - `true`, `yes`, `ON ` - is off, and named, so a
 * typo is seen in the logs rather than taken as a yes. It never stops the app
 * starting: a typo here must not take the site down.
 *
 * Automated calls also need browser calling set up; `api/index.ts` puts the
 * two together. Pure, and kept apart from src/config.ts for the same reason as
 * twilio-settings.ts: tested without the process exiting over some unrelated
 * missing variable.
 */

export interface AutoCallsSetting {
  on: boolean;
  /** What it said when that was neither `on`, `off` nor empty - to be logged. */
  unknown: string | null;
}

export function readAutoCalls(env: Record<string, string | undefined>): AutoCallsSetting {
  const raw = env.AUTO_CALLS ?? '';
  if (raw === 'on') return { on: true, unknown: null };
  if (raw === '' || raw === 'off') return { on: false, unknown: null };
  return { on: false, unknown: raw };
}

/**
 * Which numbers an automated call may ring outside production -
 * `AUTO_CALL_TEST_NUMBERS`, T12. Comma-separated, E.164:
 * `+16025550123,+16025550124`.
 *
 * On a laptop, or any copy that is not production, an automated call rings
 * only a number on this list - our own phones - whatever lead it is for, so a
 * copy of real leads can never ring a real person. Empty, nothing can be
 * called. Production does not read it: any lead may be called there.
 */
export interface AutoCallNumbers {
  /** The numbers that may be rung; null when any may - production. */
  only: ReadonlySet<string> | null;
  /** How many entries were not E.164 numbers - ignored, and counted for the log, never named. */
  invalid: number;
}

const E164 = /^\+[1-9]\d{7,14}$/;

export function readAutoCallTestNumbers(env: Record<string, string | undefined>, production: boolean): AutoCallNumbers {
  if (production) return { only: null, invalid: 0 };
  const entries = (env.AUTO_CALL_TEST_NUMBERS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const valid = entries.filter((entry) => E164.test(entry));
  return { only: new Set(valid), invalid: entries.length - valid.length };
}

/** Whether an automated call may ring `phone` here. */
export function mayRing(numbers: AutoCallNumbers, phone: string): boolean {
  return numbers.only === null || numbers.only.has(phone);
}
