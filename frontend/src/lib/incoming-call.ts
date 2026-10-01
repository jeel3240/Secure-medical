import { create } from 'zustand';
import { getCallConfig } from '../api/calls';
import { claimLead } from '../api/leads';
import type { CallEvent } from './call-state';
import { describeCallError, listenForCalls, type CallHandle, type IncomingRing } from './calling';
import { incomingReducer, NO_CALL, type IncomingEvent, type IncomingState } from './incoming-state';

/**
 * The incoming call this browser is ringing with or is on - TWILIO.md,
 * "Incoming calls".
 *
 * A store rather than a page's state because a call can arrive on any screen,
 * and because the lead's own Call button must know a call is under way
 * (`CallControl.tsx`). The app shell starts it and draws it
 * (`layout/IncomingCall.tsx`); the rules are `lib/incoming-state.ts`.
 */

interface IncomingCallStore {
  state: IncomingState;
  /** True once this browser is listening for calls: calling is set up, and someone is signed in. */
  ringable: boolean;
  /** Lets this browser be rung, if calling is set up. Returns how to stop. */
  listen: () => () => void;
  /** Picks up. Resolves once the lead has been taken over, so the page it opens is theirs. */
  answer: () => Promise<void>;
  decline: () => void;
  hangUp: () => void;
  setMuted: (muted: boolean) => void;
  sendDigits: (digits: string) => void;
  /** Clears a missed call, or a finished call's note box. */
  dismiss: () => void;
}

/** The ring being shown, and the call once answered. Not state: nothing draws them. */
let ring: IncomingRing | null = null;
let handle: CallHandle | null = null;

export const useIncomingCall = create<IncomingCallStore>((set, get) => {
  const send = (event: IncomingEvent) => set({ state: incomingReducer(get().state, event) });

  return {
    state: NO_CALL,
    ringable: false,

    listen() {
      let stop: (() => void) | null = null;
      let stopped = false;

      void getCallConfig()
        .then((config) => {
          if (stopped || !config.enabled) return;
          set({ ringable: true });
          stop = listenForCalls({
            onRing: (incoming) => {
              const before = get().state;
              send({ type: 'ring', caller: incoming.lead, at: Date.now() });
              // Shown, or turned away because this agent is already on a call.
              if (get().state !== before) ring = incoming;
            },
            onRingOver: (incoming) => {
              if (ring !== incoming) return;
              ring = null;
              send({ type: 'ring_over', at: Date.now() });
            },
          });
        })
        // Calling's state is unknown: this browser simply cannot be rung, and
        // the caller hears that we will call back.
        .catch(() => undefined);

      return () => {
        stopped = true;
        stop?.();
        handle?.hangUp();
        ring = null;
        handle = null;
        set({ state: NO_CALL, ringable: false });
      };
    },

    async answer() {
      const incoming = ring;
      if (!incoming || get().state.phase !== 'ringing') return;
      ring = null;
      send({ type: 'answer' });

      const onCall = (event: CallEvent) => send({ type: 'call', event });
      try {
        handle = incoming.answer({
          onRinging: () => undefined,
          onAnswered: () => onCall({ type: 'answered', at: Date.now() }),
          onMuted: (muted) => onCall({ type: 'muted', muted }),
          onEnded: () => {
            handle = null;
            // Over before it connected means it was dropped, not that nobody answered.
            onCall({ type: 'ended', at: Date.now(), byAgent: true });
          },
          onFailed: (message) => {
            handle = null;
            onCall({ type: 'failed', message });
          },
        });
      } catch (err) {
        onCall({ type: 'failed', message: describeCallError(err) });
        return;
      }

      // Answering is working the lead: take it, so a note and an outcome can be
      // saved. Already theirs when the call was rung through to the holder; a
      // refusal here means someone else picked it up meanwhile, and the lead's
      // page says so.
      if (incoming.lead.id > 0) await claimLead(incoming.lead.id).catch(() => undefined);
    },

    decline() {
      if (get().state.phase !== 'ringing') return;
      ring?.decline();
      ring = null;
      send({ type: 'declined' });
    },

    hangUp: () => handle?.hangUp(),
    setMuted: (muted) => handle?.setMuted(muted),
    sendDigits: (digits) => handle?.sendDigits(digits),

    dismiss() {
      send({ type: 'dismiss' });
      send({ type: 'call', event: { type: 'reset' } });
    },
  };
});
