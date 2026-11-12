/**
 * What ConversationRelay and our relay say to each other - docs/AI-AGENT.md
 * section 1, "What the first test calls showed" (A02), and A10.
 *
 * Pure: the relay's address, whether a connection is Twilio's, reading each
 * message Twilio sends, and the turns kept for the ones that are not words.
 * The shapes are as they arrived on the dev number's test calls, not as
 * guessed from the docs.
 */

import twilio from 'twilio';

/** Where Twilio opens the relay's WebSocket. Under `/api`, so Caddy passes it on (A02). */
export const RELAY_PATH = '/api/ai/relay';

/** The relay's address for the TwiML (A13): the app's public address, as `wss://`. */
export function relayUrl(publicUrl: string): string {
  return publicUrl.replace(/^https:/, 'wss:') + RELAY_PATH;
}

/**
 * Whether a WebSocket request really came from Twilio. Its X-Twilio-Signature
 * is for the `wss://` address exactly as the TwiML gave it, query included,
 * with no parameters - the same address as `https://`, or without its query,
 * does not match (A02). Rebuilt from PUBLIC_URL, never from the request's own
 * host, as every webhook's is (`isFromTwilio`).
 */
export function relaySigned(
  authToken: string,
  publicUrl: string,
  request: { signature: string | undefined; url: string }
): boolean {
  if (!request.signature) return false;
  const base = publicUrl.replace(/^https:/, 'wss:');
  return twilio.validateRequest(authToken, request.signature, base + request.url, {});
}

/** One message from ConversationRelay, as the relay uses it. */
export type RelayMessage =
  /**
   * The first message. `callId` is our `calls` row, from the TwiML's
   * `<Parameter name="call">`; null when it is missing or not a row id.
   */
  | { type: 'setup'; callSid: string; callId: number | null }
  /** What the lead said. `last` false is a partial, only sent if asked for. */
  | { type: 'prompt'; text: string; last: boolean }
  | { type: 'dtmf'; digit: string }
  /** The lead spoke over Seri: what she had said by then, and after how long. */
  | { type: 'interrupt'; heard: string; durationMs: number | null }
  /** `agentSpeaking` and `clientSpeaking`, `on` and `off`. */
  | { type: 'speaking'; who: 'agent' | 'client'; on: boolean }
  | { type: 'error'; description: string }
  /** Anything else Twilio sends: not used. */
  | { type: 'other' };

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A `<Parameter>` row id, as Twilio passes every parameter: a string. */
function rowId(v: unknown): number | null {
  const s = text(v);
  return /^[1-9]\d{0,9}$/.test(s) && Number(s) <= 2147483647 ? Number(s) : null;
}

/** Null when it is not JSON, or not an object with a `type`. */
export function parseRelayMessage(raw: string): RelayMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null || typeof (m as { type?: unknown }).type !== 'string') return null;
  const msg = m as Record<string, unknown>;
  switch (msg.type) {
    case 'setup': {
      const params = typeof msg.customParameters === 'object' && msg.customParameters !== null ? msg.customParameters : {};
      return { type: 'setup', callSid: text(msg.callSid), callId: rowId((params as Record<string, unknown>).call) };
    }
    case 'prompt':
      return { type: 'prompt', text: text(msg.voicePrompt).trim(), last: msg.last !== false };
    case 'dtmf':
      return { type: 'dtmf', digit: text(msg.digit) };
    case 'interrupt': {
      const ms = Number(msg.durationUntilInterruptMs);
      return {
        type: 'interrupt',
        heard: text(msg.utteranceUntilInterrupt),
        durationMs: Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null,
      };
    }
    case 'info':
      if ((msg.name === 'agentSpeaking' || msg.name === 'clientSpeaking') && (msg.value === 'on' || msg.value === 'off')) {
        return { type: 'speaking', who: msg.name === 'agentSpeaking' ? 'agent' : 'client', on: msg.value === 'on' };
      }
      return { type: 'other' };
    case 'error':
      return { type: 'error', description: text(msg.description) };
    default:
      return { type: 'other' };
  }
}

/** Seri says a line: the whole of it, in one message. */
export function textMessage(line: string): string {
  return JSON.stringify({ type: 'text', token: line, last: true });
}

// The turns that are not someone's words, as kept in `call_ai_turns`. A key is
// the lead's; a cut-off line and Twilio's error are the relay's own notes.

/** A key the lead pressed, kept as their turn. */
export const keyTurn = (digit: string): string => `(pressed ${digit})`;

/** The lead spoke over Seri: what she had said by then. */
export const interruptedNote = (heard: string): string => `Cut off. Heard: "${heard}"`;

/** Twilio reported an error on the relay. Kept here, not in the logs: it can quote her words. */
export const twilioErrorNote = (description: string): string => `Twilio error: ${description}`;
