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
import { handoffData, type Handoff } from './actions';
import type { SafetyReason } from './safety';

/** Where Twilio opens the relay's WebSocket. Under `/api`, so Caddy passes it on (A02). */
export const RELAY_PATH = '/api/ai/relay';

/** The relay's address for the TwiML (A13): the app's public address, as `wss://`. */
export function relayUrl(publicUrl: string): string {
  return publicUrl.replace(/^https:/, 'wss:') + RELAY_PATH;
}

/** The `<Parameter>` that names our `calls` row; it arrives in `setup` under `customParameters`. */
export const CALL_PARAMETER = 'call';

/**
 * How ConversationRelay listens and speaks on Seri's calls - the settings
 * heard together on the dev number (A02; docs/AI-AGENT.md section 1, "The
 * settings A13 starts from"), written as the test calls wrote them:
 *
 * - Rachel on ElevenLabs's `v4` model, stability 0.4, similarity 0.8 - Jeel's pick;
 * - Deepgram's `flux`, which waits for the end of a thought - `nova-3` sent
 *   half a sentence at a pause;
 * - stopped by speech, and only clear speech; "uh huh" does not stop her;
 * - numbers and short forms read as words;
 * - keys sent to us, and who is speaking - the silence count needs it (A12);
 * - Twilio trying again if our WebSocket drops.
 */
export const RELAY_SETTINGS: Readonly<Record<string, string>> = {
  ttsProvider: 'ElevenLabs',
  voice: '21m00Tcm4TlvDq8ikWAM-v4-0.4_0.8',
  transcriptionProvider: 'Deepgram',
  speechModel: 'flux',
  interruptible: 'speech',
  interruptSensitivity: 'low',
  ignoreBackchannel: 'true',
  elevenlabsTextNormalization: 'on',
  dtmfDetection: 'true',
  events: 'speaker-events',
  applicationReconnect: 'true',
};

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
      return { type: 'setup', callSid: text(msg.callSid), callId: rowId((params as Record<string, unknown>)[CALL_PARAMETER]) };
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

/**
 * Words for Twilio to say. A reply goes a sentence at a time, `last` false,
 * then an empty `last` true to close it; a line said on its own is one
 * message, `last` true.
 */
export function textMessage(token: string, last: boolean): string {
  return JSON.stringify({ type: 'text', token, last });
}

/** Ends the session: Twilio says what it was given, then posts the action URL with this as `HandoffData` (A02). */
export function endMessage(handoff: Handoff): string {
  return JSON.stringify({ type: 'end', handoffData: handoffData(handoff) });
}

// The turns that are not someone's words, as kept in `call_ai_turns`. A key is
// the lead's; the rest are the relay's own notes.

/** How a key the lead pressed begins its turn - read back by the voicemail rule (A18): only a person presses keys. */
export const KEY_TURN_PREFIX = '(pressed ';

export const keyTurn = (digit: string): string => `${KEY_TURN_PREFIX}${digit})`;

/** The lead spoke over Seri: what she had said by then. */
export const interruptedNote = (heard: string): string => `Cut off. Heard: "${heard}"`;

/** Twilio reported an error on the relay. Kept here, not in the logs: it can quote her words. */
export const twilioErrorNote = (description: string): string => `Twilio error: ${description}`;

/** A sentence the check replaced with the specialist line (A05): why, the words found, and the sentence. */
export const replacedNote = (reason: SafetyReason, found: string | null, sentence: string): string =>
  `Replaced (${reason}${found ? `, "${found}"` : ''}): ${sentence}`;

/** An action refused, and what she was told (A06). */
export const refusedNote = (action: string, error: string): string => `Not done: ${action}. ${error}`;

/** The relay's own stop check ended the call, whatever she would have said (A11). */
export const stopNote = (via: 'words' | 'key'): string =>
  via === 'key' ? 'Stop key 9 pressed: opted out.' : 'Stop words heard: opted out.';
