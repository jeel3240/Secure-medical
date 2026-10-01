import type { Call, Device } from '@twilio/voice-sdk';
import { toApiError } from '../api/client';
import { getCallToken } from '../api/calls';

/**
 * Calls in the browser, placed and received - Phase 4, TWILIO.md.
 *
 * The only file that touches Twilio's Voice SDK. It turns the SDK's events into
 * the plain callbacks `lib/call-state.ts` understands, so nothing above it
 * knows Twilio exists.
 *
 * The SDK is its own chunk, fetched after the app is on screen rather than
 * with it: it is large, and the queue should not wait for it.
 *
 * One Device for the whole session. It holds the microphone and the connection
 * to Twilio, and it refreshes its own token before the hour runs out. If
 * anything goes wrong it is thrown away, so the next call starts clean rather
 * than reusing a device in an unknown state.
 *
 * **Receiving.** A lead who calls our number rings the browser of one agent
 * (TWILIO.md, "Incoming calls"). That only works while this Device is
 * registered with Twilio, so `listenForCalls` registers it as soon as an agent
 * is signed in and checks every half minute that it still is - a laptop that
 * slept, a token that could not be refreshed, a device discarded after a
 * failed call all end the registration without anyone being told.
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

/** A lead ringing this browser, not yet answered. */
export interface IncomingRing {
  lead: { id: number; name: string; phone: string };
  /** Pick up. Everything after that arrives through the handlers. */
  answer: (handlers: CallHandlers) => CallHandle;
  /** Send them to the "we will call you back" message instead. */
  decline: () => void;
}

export interface IncomingHandlers {
  onRing: (ring: IncomingRing) => void;
  /** It stopped ringing unanswered: the lead hung up, or it rang out. */
  onRingOver: (ring: IncomingRing) => void;
}

const REGISTRATION_CHECK_MS = 30_000;

let devicePromise: Promise<Device> | null = null;
/** Set while someone is signed in and calling is on: this browser can be rung. */
let listener: IncomingHandlers | null = null;

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
    device.on('incoming', (call: Call) => listener && announce(call, listener));
    // Without a listener the SDK throws a registration error as uncaught. The
    // half-minute check is what puts it right.
    device.on('error', () => undefined);
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

/** Registers the device if it is not; replaces one that has been destroyed. */
async function keepRegistered(): Promise<void> {
  if (!listener) return;
  try {
    const device = await getDevice();
    if (device.state === 'destroyed') discardDevice();
    else if (device.state === 'unregistered') await device.register();
  } catch {
    // Offline, signed out, or Twilio unreachable. Start clean at the next check.
    discardDevice();
  }
}

/**
 * Lets this browser be rung, until the returned function is called. One
 * listener at a time - the app shell's.
 */
export function listenForCalls(handlers: IncomingHandlers): () => void {
  listener = handlers;
  void keepRegistered();
  const timer = window.setInterval(() => void keepRegistered(), REGISTRATION_CHECK_MS);
  return () => {
    window.clearInterval(timer);
    listener = null;
    // Signed out: this browser must stop ringing for them.
    discardDevice();
  };
}

/** Who is calling, from what the server attached to the call - `ringAgentTwiml`. */
export function incomingLead(params: Map<string, string>, from: string | undefined): IncomingRing['lead'] {
  const id = Number(params.get('leadId'));
  return {
    id: Number.isInteger(id) && id > 0 ? id : 0,
    name: params.get('leadName')?.trim() ?? '',
    phone: params.get('leadPhone') || from || '',
  };
}

function announce(call: Call, handlers: IncomingHandlers): void {
  let answered = false;
  const ring: IncomingRing = {
    lead: incomingLead(call.customParameters, call.parameters.From),
    answer: (callHandlers) => {
      answered = true;
      const handle = wire(call, callHandlers);
      call.accept();
      return handle;
    },
    decline: () => {
      answered = true;
      call.reject();
    },
  };
  // Before it is answered, the ring ending is a missed call. Once it is, the
  // call's own handlers report how it ended.
  call.on('cancel', () => !answered && handlers.onRingOver(ring));
  handlers.onRing(ring);
}

/** Joins a call's events to the handlers, and returns its controls. */
function wire(call: Call, handlers: CallHandlers): CallHandle {
  return wire(call, handlers);
}

/** Twilio's error codes that an agent can do something about. */
const MESSAGE_FOR_CODE: Record<number, string> = {
  31401: 'Allow microphone access for this site in your browser, then call again.',
  31402: 'No microphone was found. Plug one in, or check your sound settings, then call again.',
  20104: 'Your calling session expired. Call again.',
  // Twilio sends 31005 both when the line drops and when the number cannot be
  // dialled at all (an invalid number - found 2026-10-01 calling a test lead's
  // made-up 555 number, where "check your internet" pointed the wrong way).
  31005: 'The call did not connect. The number may not be reachable, or the connection dropped.',
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

  return wire(call, handlers);
}
