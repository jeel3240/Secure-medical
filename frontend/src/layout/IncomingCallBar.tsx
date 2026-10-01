import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatPhone } from '../lib/format';
import { useIncomingCall } from '../lib/incoming-call';
import type { Caller } from '../lib/incoming-state';
import { useSecond } from '../lib/useSecond';
import { CallBar, initials } from '../pages/workspace/CallBar';

/**
 * A lead calling our number, on whichever screen the agent is - TWILIO.md,
 * "Incoming calls". Jeel, 2026-10-01: show it to that agent when the call
 * comes; if they do not pick up, say on screen that they missed it.
 *
 *   ringing   [PS] Priya Sharma (555) 010-0016            Decline   Answer
 *                  Incoming call
 *   answered  the ordinary call bar, then its note box - `CallBar.tsx`
 *   missed    [PS] Priya Sharma (555) 010-0016            Dismiss   Open lead
 *                  Missed call · they were told we will call back
 *
 * Mounted once, in the app shell, and it is also what makes this browser
 * ringable: it starts listening when someone is signed in and stops when they
 * are not. Answering opens the lead, so the agent is looking at who they are
 * talking to.
 *
 * The same dark bar in the same place as an outgoing call's, because to the
 * agent it is the same thing: a call, at the foot of the screen.
 */
export function IncomingCallBar() {
  const { state, listen, answer, decline, dismiss, hangUp, setMuted, sendDigits } = useIncomingCall();
  const navigate = useNavigate();

  useEffect(() => listen(), [listen]);

  if (state.phase === 'none') return null;
  const { caller } = state;
  const openLead = () => caller.id > 0 && navigate(`/leads/${caller.id}`);

  if (state.phase === 'call') {
    return (
      <LiveCall
        caller={caller}
        call={{ state: state.call, hangUp, setMuted, sendDigits, dismiss }}
      />
    );
  }

  const ringing = state.phase === 'ringing';
  return (
    <div
      className={`call-bar call-bar--${ringing ? 'incoming' : 'missed'}`}
      // Announced, but focus is not moved: an agent typing a text must not
      // answer a call with the space bar.
      role={ringing ? 'alert' : 'region'}
      aria-label={ringing ? 'Incoming call' : 'Missed call'}
    >
      <Who caller={caller} presence={ringing ? 'dialing' : 'off'}>
        {ringing ? 'Incoming call' : 'Missed call · they were told we will call back'}
      </Who>

      {ringing ? (
        <>
          <button type="button" className="call-bar__button call-bar__button--plain" onClick={decline}>
            Decline
          </button>
          <button
            type="button"
            className="call-bar__button call-bar__button--answer"
            onClick={() => {
              // Opened once the lead is theirs, so the page arrives with its
              // actions on rather than asking them to pick it up mid-call.
              void answer().then(openLead);
            }}
          >
            Answer
          </button>
        </>
      ) : (
        <>
          <button type="button" className="call-bar__button call-bar__button--plain" onClick={dismiss}>
            Dismiss
          </button>
          {caller.id > 0 && (
            <button
              type="button"
              className="call-bar__button call-bar__button--save"
              onClick={() => {
                dismiss();
                openLead();
              }}
            >
              Open lead
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** A name to show: the lead's, or the number when we hold no name. */
function shownName(caller: Caller): string {
  return caller.name || formatPhone(caller.phone);
}

function Who({
  caller,
  presence,
  children,
}: {
  caller: Caller;
  presence: 'dialing' | 'off';
  children: string;
}) {
  return (
    <div className="call-bar__who">
      <span className="call-bar__avatar" aria-hidden="true">
        {initials(caller.name)}
        <span className={`call-bar__presence call-bar__presence--${presence}`} />
      </span>
      <div className="call-bar__id">
        <p className="call-bar__name">
          {shownName(caller)}
          {caller.name && <span className="call-bar__phone tabular">{formatPhone(caller.phone)}</span>}
        </p>
        <p className="call-bar__state" role="status">
          {children}
        </p>
      </div>
    </div>
  );
}

/** Split out so the clock ticks only while there is a call to time. */
function LiveCall({ caller, call }: { caller: Caller; call: Parameters<typeof CallBar>[0]['call'] }) {
  const now = useSecond();
  return (
    <CallBar
      who={{ leadId: caller.id, name: shownName(caller), phone: caller.name ? caller.phone : '' }}
      call={call}
      now={now}
      // The lead's page polls; the note shows there on its next round.
      onNoteSaved={() => undefined}
    />
  );
}
