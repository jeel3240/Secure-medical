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
