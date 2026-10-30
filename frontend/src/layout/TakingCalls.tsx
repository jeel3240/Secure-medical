import { useEffect, useState } from 'react';
import { getCallConfig, setTakingCalls } from '../api/calls';
import { useAuth } from '../auth/store';
import { markSwitchedHere, missedTransfer } from '../lib/taking-calls';

/**
 * The "Taking calls" switch in the app bar - T10, AUTO-CALLS.md "Who is free".
 *
 * Only people with it on are rung for a transfer from an automated call. The
 * switch decides, not the role: a superadmin who works leads turns it on, one
 * who does not leaves it off. It starts off at every sign-in.
 *
 * Shown only while automated calls are on. It shows what the server holds,
 * flipping once the server has it: a switch that showed "on" before it was
 * saved could leave someone thinking they will be rung when they will not.
 * A failure leaves it where it was, and says so on hover.
 *
 * Letting a transfer ring out turns it off (T15c): the server does it, the
 * browser hears within half a minute (`lib/taking-calls.ts`), and a notice
 * beside the switch says why until it is switched on again.
 */
export function TakingCalls() {
  const on = useAuth((s) => s.user?.takingCalls ?? false);
  const missed = useAuth((s) => (s.user ? missedTransfer(s.user) : false));
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getCallConfig()
      .then((config) => alive && setShown(config.enabled && config.autoCalls))
      // Unknown is hidden: a switch that cannot be saved is worse than none.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!shown) return null;

  const toggle = async () => {
    setSaving(true);
    setFailed(false);
    // A report answered meanwhile carries the switch as it was: not taken.
    markSwitchedHere();
    try {
      const now = await setTakingCalls(!on);
      markSwitchedHere();
      // The user as it is now, not as it was when this rendered.
      const user = useAuth.getState().user;
      if (user) useAuth.getState().setUser({ ...user, ...now });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {missed && (
        <span className="taking-calls__notice" role="status">
          Missed a transfer · Taking calls off
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="taking-calls"
        disabled={saving}
        title={
          failed
            ? 'Could not switch it. Try again.'
            : on
              ? 'You can be rung for a transfer.'
              : 'You will not be rung for a transfer.'
        }
        onClick={() => void toggle()}
      >
        <span className="taking-calls__track" aria-hidden="true">
          <span className="taking-calls__thumb" />
        </span>
        Taking calls
      </button>
    </>
  );
}
