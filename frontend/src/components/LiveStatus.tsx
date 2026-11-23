import { useSecond } from '../lib/useSecond';

/**
 * "Live · updated just now" beside a page title, or "Live updates paused" when
 * the last poll failed - on every screen that updates by itself, so each says
 * so the same way.
 *
 * Its own one-second clock (`useSecond`, one copy since review Q7,
 * 2026-11-23), so "updated 12s ago" counts up between polls without making the
 * whole page re-render every second.
 */
export function LiveStatus({ updatedAt, paused }: { updatedAt: number | null; paused: boolean }) {
  const now = useSecond().getTime();

  let label = 'Connecting';
  if (paused) {
    label = 'Live updates paused';
  } else if (updatedAt) {
    const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
    label =
      seconds < 10
        ? 'Live · updated just now'
        : seconds < 60
          ? `Live · updated ${seconds}s ago`
          : `Live · updated ${Math.floor(seconds / 60)}m ago`;
  }

  return (
    <span className={`live${paused ? ' live--paused' : ''}`}>
      <span className="live__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
