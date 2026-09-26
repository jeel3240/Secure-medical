import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from './client';

/**
 * The one place every live screen fetches from.
 *
 * Phase 3 task 14. The queue, the workspace, the timeline, My Callbacks and the
 * admin pages all need to update without the agent pressing anything, and
 * `QUEUE.md` settled how: poll every 5 seconds. At 50-100 leads a day nobody
 * can tell it from a push, and it needs nothing new on the server.
 *
 * It lives in one place so that a real push - websockets, SSE - can replace the
 * inside of this file later without any screen changing. That is the whole
 * reason it is a hook and not a `setInterval` per page; there was one of those
 * in `admin/LeadsPage.tsx`, and copying it to eleven more screens is how five
 * different refresh behaviours get shipped.
 *
 * What it gives a screen:
 *
 * - `data` survives a refresh. The table never blanks out mid-poll, because a
 *   background fetch replaces the data only once it arrives.
 * - `loading` is true only when there is nothing to show yet, so a spinner
 *   appears on the first load and on a filter change, never on a tick.
 * - `error` does not throw away `data`. A dropped connection shows a banner
 *   over the last good table rather than an empty screen - the design brief
 *   asks for "Live updates paused", not a blank page.
 * - `refresh()` for after a write, so a claim or a note appears at once instead
 *   of up to five seconds later.
 */

/** Every live screen polls at this interval - QUEUE.md, Jeel 2026-09-23. */
export const POLL_MS = 5000;

export interface Polled<T> {
  data: T | null;
  /** True only while there is nothing to show. A tick never sets it. */
  loading: boolean;
  /** The last error, kept alongside stale data rather than replacing it. */
  error: string | null;
  /** Fetch now. Returns once the fetch settles, so callers can await a write. */
  refresh: () => Promise<void>;
  /** When the last successful fetch landed, for the "Live" indicator. */
  updatedAt: number | null;
}

export interface PollingOptions {
  /** Milliseconds between ticks. Defaults to POLL_MS. */
  intervalMs?: number;
  /** When false, no polling and no fetch. For a screen that is not ready yet. */
  enabled?: boolean;
}

/**
 * @param fetcher  Must be stable - wrap it in `useCallback` with the filters as
 *                 dependencies. When it changes, that counts as a new view:
 *                 the spinner returns and the old data is cleared, which is
 *                 what a filter change should look like.
 */
export function usePolling<T>(fetcher: () => Promise<T>, options: PollingOptions = {}): Polled<T> {
  const { intervalMs = POLL_MS, enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Guards a slow first response against a fast second one: without this, a
  // filter change that resolves before the request it replaced would be
  // overwritten by the older answer.
  const requestId = useRef(0);
  // Set on unmount so a fetch in flight cannot call setState afterwards.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A new fetcher means new filters, so the old rows no longer belong to this
  // view. Cleared here rather than inside the fetch, so the spinner shows
  // immediately rather than after the round trip.
  useEffect(() => {
    setData(null);
    setError(null);
  }, [fetcher]);

  const run = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const next = await fetcher();
      if (!alive.current || id !== requestId.current) return;
      setData(next);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (err) {
      if (!alive.current || id !== requestId.current) return;
      // Deliberately leaves `data` alone: a failed tick should not wipe a table
      // an agent is reading. The screen shows a banner over the stale rows.
      setError(toApiError(err).message);
    }
  }, [fetcher]);

  useEffect(() => {
    if (!enabled) return;

    void run();
    const timer = setInterval(() => void run(), intervalMs);
    return () => clearInterval(timer);
  }, [run, intervalMs, enabled]);

  return {
    data,
    loading: data === null && error === null,
    error,
    refresh: run,
    updatedAt,
  };
}
