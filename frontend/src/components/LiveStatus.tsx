import { useEffect, useState } from 'react';

/**
 * "Live · updated just now" beside a page title, or "Live updates paused" when
 * the last poll failed. Shared by the queue and Admin > Leads so both screens
 * that update by themselves say so the same way.
 *
 * It keeps its own one-second clock, so "updated 12s ago" counts up between
 * polls without making the whole page re-render every second.
 */
export function LiveStatus({ updatedAt, paused }: { updatedAt: number | null; paused: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
