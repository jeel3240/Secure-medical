import { useEffect, useState } from 'react';
import { getCallConfig, type CallConfig } from '../../api/calls';
import type { LeadDetail } from '../../api/workspace';
import { Button } from '../../components/Button';
import { callBlockedReason, callClock, endedText } from '../../lib/call-state';
import { formatPhone } from '../../lib/format';
import { useLeadCall } from './useLeadCall';

/**
 * The Call button, and the call once it is placed - Phase 4, TWILIO.md.
 *
 *   Call  ->  Connecting…  ->  Ringing…  ->  0:42  Mute  Hang up  ->  Call ended · 2:14
 *
 * Calls go out from the browser through Twilio, showing the client's number.
 * The button is off, with the reason as a tooltip, when the number is on the
 * do-not-call list, when calling is not set up on the server, or when the
 * viewer has not picked the lead up. The server checks the same things again
 * when the call starts, so these are a courtesy, not the lock.
 *
 * In the header's plain style: words and a clock, no coloured panel. The one
 * colour is the red on Hang up, because it ends something.
 */
export function CallControl({
  lead,
  mine,
  now,
  onCallOver,
}: {
  lead: LeadDetail;
  /** The viewer holds the lead. */
  mine: boolean;
  /** Ticks every second, for the live clock. */
  now: Date;
  /** A call ended: the page reloads what it shows. */
  onCallOver: () => void;
}) {
  const [config, setConfig] = useState<CallConfig | null>(null);
  const { state, start, hangUp, setMuted } = useLeadCall(lead.id, onCallOver);

  useEffect(() => {
    let alive = true;
    getCallConfig()
      .then((loaded) => alive && setConfig(loaded))
      // Unknown is treated as off: a Call button that cannot work is worse
      // than one that says why it is off.
      .catch(() => alive && setConfig({ enabled: false, callerId: null }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.phase === 'connecting' || state.phase === 'ringing') {
    return (
      <div className="call" role="status">
        <span className="call__status">{state.phase === 'connecting' ? 'Connecting…' : 'Ringing…'}</span>
        <Button variant="danger" onClick={hangUp}>
          Hang up
        </Button>
      </div>
    );
  }

  if (state.phase === 'live') {
    const seconds = Math.max(0, (now.getTime() - state.since) / 1000);
    return (
      <div className="call">
        <span className="call__status call__status--live" role="timer" aria-label="Call length">
          <span className="call__dot" aria-hidden="true" />
          <span className="tabular">{callClock(seconds)}</span>
        </span>
        <Button variant="secondary" aria-pressed={state.muted} onClick={() => setMuted(!state.muted)}>
          {state.muted ? 'Unmute' : 'Mute'}
        </Button>
        <Button variant="danger" onClick={hangUp}>
          Hang up
        </Button>
      </div>
    );
  }

  const blocked = callBlockedReason({
    enabled: config ? config.enabled : null,
    holdsLead: mine,
    onDncList: lead.flags.dnc,
  });

  return (
    <div className="call">
      {state.phase === 'ended' && (
        <span className="call__status" role="status">
          {endedText(state)}
        </span>
      )}
      {state.phase === 'failed' && (
        <span className="call__status call__status--error" role="alert">
          {state.message}
        </span>
      )}
      <Button
        variant="secondary"
        disabled={blocked !== null}
        title={blocked ?? (config?.callerId ? `The lead will see ${formatPhone(config.callerId)}` : undefined)}
        onClick={start}
      >
        Call
      </Button>
    </div>
  );
}
