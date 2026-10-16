/**
 * Whether `twilio:configure` may point a TwiML App or a phone number at this
 * server - pure, so every case is tested without Twilio. TWILIO.md, "What it
 * needs on the Twilio account".
 *
 * **Why it exists.** Until 2026-10-16 the command refused only a number whose
 * calls went to something that was not this app, and changed the TwiML App
 * without asking at all. A laptop and production are the same app, with the
 * same webhook paths, so run from a laptop with production's number and TwiML
 * App it went straight through: production's calls moved to the laptop, and
 * nothing said so (Jeel, 2026-10-05). It now also refuses anything that points
 * at this app **on another real server** - production, from a laptop.
 *
 * What it may point without `--take-over`:
 *
 *   - something already pointing here (nothing to do), or pointing nowhere;
 *   - this app on the same server - a different method, say;
 *   - this app on a tunnel - an earlier laptop session, or production's own
 *     calls after an accident, being brought back by running it on the server.
 *
 * What it refuses without `--take-over`: this app on another real server, a
 * different address altogether (somebody's working phone line), or a number
 * whose calls go to another TwiML App.
 */

export interface PointedAt {
  voiceUrl: string | null;
  voiceMethod?: string | null;
  /** A number's TwiML App, which wins over its Voice URL. Apps have none. */
  applicationSid?: string | null;
}

export type Pointing =
  | { action: 'unchanged' }
  | { action: 'point' }
  | {
      action: 'refuse';
      /**
       * `other_server`: this app, on another real server. `elsewhere`: an
       * address that is not this app. `other_app`: a number answered by
       * another TwiML App.
       */
      why: 'other_server' | 'elsewhere' | 'other_app';
      /** Where it points now, for the message. */
      current: string;
    };

/**
 * Quick-tunnel hosts: an address that changes every time a tunnel starts, so
 * never a deployment anyone relies on.
 */
const TUNNEL_HOSTS = [/\.trycloudflare\.com$/i, /\.ngrok(-free)?\.(app|dev|io)$/i];

export function isTunnelHost(hostname: string): boolean {
  return TUNNEL_HOSTS.some((pattern) => pattern.test(hostname));
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * What to do with one app or number that should point at `target`.
 * `takeOver` is the person running the command saying they mean it.
 */
export function decidePointing(now: PointedAt, target: string, takeOver: boolean): Pointing {
  const url = now.voiceUrl || null;
  if (url === target && (now.voiceMethod ?? 'POST') === 'POST' && !now.applicationSid) return { action: 'unchanged' };
  if (takeOver) return { action: 'point' };

  if (now.applicationSid) return { action: 'refuse', why: 'other_app', current: `TwiML App ${now.applicationSid}` };
  if (!url) return { action: 'point' };

  const current = parse(url);
  const wanted = parse(target);
  // Not this app's path: somebody else's line, wherever it is.
  if (!current || !wanted || current.pathname !== wanted.pathname) {
    return { action: 'refuse', why: 'elsewhere', current: url };
  }
  if (current.host === wanted.host || isTunnelHost(current.hostname)) return { action: 'point' };
  return { action: 'refuse', why: 'other_server', current: url };
}
