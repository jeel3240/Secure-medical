import { useEffect, useState } from 'react';
import { getCallConfig, type CallConfig } from '../../api/calls';
import type { LeadDetail } from '../../api/workspace';
import { Button } from '../../components/Button';
import { callBlockedReason, isActive } from '../../lib/call-state';
import { formatPhone } from '../../lib/format';
import type { LeadCall } from './useLeadCall';

/**
 * The Call button in the lead header - Phase 4, TWILIO.md.
 *
 * Only the button: once pressed, the call lives in the call bar at the foot of
 * the screen (`CallBar.tsx`), which stays in view while the agent reads the
 * conversation or types - Jeel's design, 2026-10-01. Until then the header
 * itself turned into the call's controls.
 *
 * Off, with the reason as a tooltip, when the number is on the do-not-call
 * list, when calling is not set up on the server, or when the viewer has not
 * picked the lead up. The server checks the same things again when the call
 * starts, so these are a courtesy, not the lock.
 */
export function CallControl({
  lead,
  mine,
  call,
}: {
  lead: LeadDetail;
  /** The viewer holds the lead. */
  mine: boolean;
  call: LeadCall;
}) {
  const [config, setConfig] = useState<CallConfig | null>(null);

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

  const onCall = isActive(call.state);
  const blocked = callBlockedReason({
    enabled: config ? config.enabled : null,
    holdsLead: mine,
    onDncList: lead.flags.dnc,
  });

  return (
    <Button
      variant="secondary"
      disabled={onCall || blocked !== null}
      title={
        onCall
          ? 'A call is in progress.'
          : (blocked ?? (config?.callerId ? `The lead will see ${formatPhone(config.callerId)}` : undefined))
      }
      onClick={call.start}
    >
      {onCall ? 'On call' : 'Call'}
    </Button>
  );
}
