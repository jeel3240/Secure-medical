import type { Call, Device } from '@twilio/voice-sdk';
import { toApiError } from '../api/client';
import { getCallToken } from '../api/calls';

/**
 * Placing a call from the browser - Phase 4, TWILIO.md.
 *
 * The only file that touches Twilio's Voice SDK. It turns the SDK's events into
 * the plain callbacks `lib/call-state.ts` understands, so nothing above it
 * knows Twilio exists.
 *
 * The SDK is loaded on the first call, not with the app: it is large, and most
 * page loads - the queue, admin, an agent who texts - never place one.
 *
 * One Device for the whole session. It holds the microphone and the connection
 * to Twilio, and it refreshes its own token before the hour runs out. If
 * anything goes wrong it is thrown away, so the next call starts clean rather
 * than reusing a device in an unknown state.
 */

export interface CallHandlers {
  /** The lead's phone is ringing. */
  onRinging: () => void;
  /** The lead answered. */
  onAnswered: () => void;
  onMuted: (muted: boolean) => void;
  /** The call is over, however it ended. */
  onEnded: () => void;
  /** It broke. `message` is for the agent. */
  onFailed: (message: string) => void;
}

export interface CallHandle {
  hangUp: () => void;
  setMuted: (muted: boolean) => void;
  /** Keypad tones, for a phone menu or an extension: digits, * and #. */
  sendDigits: (digits: string) => void;
}

let devicePromise: Promise<Device> | null = null;

function getDevice(): Promise<Device> {
  devicePromise ??= (async () => {
    const [{ Device: DeviceClass }, token] = await Promise.all([import('@twilio/voice-sdk'), getCallToken()]);
    // closeProtection: the browser asks before closing a tab with a live call.
    const device = new DeviceClass(token, { closeProtection: true });
    device.on('tokenWillExpire', () => {
      // A failed refresh is not fatal now: the next call fails with an expired
      // token, discards this device and starts over with a fresh one.
      void getCallToken()
        .then((fresh) => device.updateToken(fresh))
        .catch(() => undefined);
    });
    return device;
  })().catch((err) => {
    devicePromise = null;
    throw err;
  });
  return devicePromise;
}

function discardDevice(): void {
  const stale = devicePromise;
  devicePromise = null;
  void stale?.then((device) => device.destroy()).catch(() => undefined);
}

/** Twilio's error codes that an agent can do something about. */
const MESSAGE_FOR_CODE: Record<number, string> = {
  31401: 'Allow microphone access for this site in your browser, then call again.',
  31402: 'No microphone was found. Plug one in, or check your sound settings, then call again.',
  20104: 'Your calling session expired. Call again.',
  31005: 'The connection to the calling service dropped. Check your internet and call again.',
  31009: 'Could not reach the calling service. Check your internet and call again.',
};

/** A sentence for the agent, from whatever went wrong. */
export function describeCallError(err: unknown): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  if (typeof code === 'number' && MESSAGE_FOR_CODE[code]) return MESSAGE_FOR_CODE[code];

  // The browser's own refusal, before Twilio is involved.
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError') return MESSAGE_FOR_CODE[31401];
  if (name === 'NotFoundError') return MESSAGE_FOR_CODE[31402];

  // Our own API: calling is off, or the session ended.
  const api = toApiError(err);
  if (api.code === 'calling_off') return 'Calling is not set up on this server.';
  if (api.status === 401) return 'You are signed out. Sign in again to call.';
  if (api.code === 'network_error') return api.message;

  return 'The call could not be placed. Try again.';
}

/**
 * Calls the lead. Resolves once the call is on its way; everything after that
 * arrives through the handlers. Rejects if it could not start at all.
 *
 * Only the lead's id is sent. The server looks up the number, and decides
 * whether this agent may call it, when Twilio asks how to connect the call.
 */
export async function placeCall(leadId: number, handlers: CallHandlers): Promise<CallHandle> {
  let call: Call;
  try {
    const device = await getDevice();
    call = await device.connect({ params: { leadId: String(leadId) } });
  } catch (err) {
    discardDevice();
    throw err;
  }

  let over = false;
  const end = () => {
    if (over) return;
    over = true;
    handlers.onEnded();
  };

  call.on('ringing', () => handlers.onRinging());
  call.on('accept', () => handlers.onAnswered());
  call.on('mute', (muted: boolean) => handlers.onMuted(muted));
  call.on('disconnect', end);
  call.on('cancel', end);
  call.on('reject', end);
  call.on('error', (err: unknown) => {
    discardDevice();
    handlers.onFailed(describeCallError(err));
  });

  return {
    hangUp: () => call.disconnect(),
    setMuted: (muted) => call.mute(muted),
    sendDigits: (digits) => call.sendDigits(digits),
  };
}
