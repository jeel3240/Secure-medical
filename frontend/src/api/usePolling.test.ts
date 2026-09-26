/**
 * The shared polling hook.
 *
 * Tested because none of this is visible in a browser: a response that arrives
 * out of order, a failed tick that must not wipe the table, a timer that must
 * stop on unmount. Twelve screens depend on it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS, usePolling } from './usePolling';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A promise we resolve by hand, to control exactly when a fetch lands. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('the first load', () => {
  it('is loading until something arrives', async () => {
    const fetcher = vi.fn().mockResolvedValue('rows');
    const { result } = renderHook(() => usePolling(fetcher));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.data).toBe('rows'));
    expect(result.current.loading).toBe(false);
    expect(result.current.updatedAt).toEqual(expect.any(Number));
  });

  it('fetches once, not twice', async () => {
    const fetcher = vi.fn().mockResolvedValue('rows');
    renderHook(() => usePolling(fetcher));

    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    // A double fetch on mount doubles the load on every screen.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('polling', () => {
  it('fetches again every interval', async () => {
    const fetcher = vi.fn().mockResolvedValue('rows');
    renderHook(() => usePolling(fetcher));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('honours a custom interval', async () => {
    const fetcher = vi.fn().mockResolvedValue('rows');
    renderHook(() => usePolling(fetcher, { intervalMs: 1000 }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does nothing while disabled', async () => {
    const fetcher = vi.fn().mockResolvedValue('rows');
    renderHook(() => usePolling(fetcher, { enabled: false }));

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS * 3);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops when the screen goes away', async () => {
    const fetcher = vi.fn().mockResolvedValue('rows');
    const { unmount } = renderHook(() => usePolling(fetcher));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS * 3);
    });
    // A timer left running after unmount polls forever and sets state on a
    // dead component.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not blank the data between ticks', async () => {
    const fetcher = vi.fn().mockResolvedValue('first');
    const { result } = renderHook(() => usePolling(fetcher));
    await waitFor(() => expect(result.current.data).toBe('first'));

    const pending = deferred<string>();
    fetcher.mockReturnValueOnce(pending.promise);

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });

    // Mid-flight: the table still shows the previous rows rather than a spinner.
    expect(result.current.data).toBe('first');
    expect(result.current.loading).toBe(false);

    await act(async () => {
      pending.resolve('second');
      await pending.promise;
    });
    expect(result.current.data).toBe('second');
  });
});

describe('when a fetch fails', () => {
  it('keeps the last good data', async () => {
    const fetcher = vi.fn().mockResolvedValue('rows');
    const { result } = renderHook(() => usePolling(fetcher));
    await waitFor(() => expect(result.current.data).toBe('rows'));

    fetcher.mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });

    // The design brief asks for "Live updates paused", not a blank page.
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBe('rows');
  });

  it('clears the error once a later tick succeeds', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue('rows');
    const { result } = renderHook(() => usePolling(fetcher));

    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.data).toBe('rows');
  });

  it('is not stuck loading when the first load fails', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => usePolling(fetcher));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    // A spinner that never stops is worse than an error message.
    expect(result.current.loading).toBe(false);
  });
});

describe('changing the filters', () => {
  it('shows a spinner again and drops the old rows', async () => {
    const fetcher = vi.fn().mockResolvedValue('hot');
    const { result, rerender } = renderHook(({ f }) => usePolling(f), {
      initialProps: { f: fetcher },
    });
    await waitFor(() => expect(result.current.data).toBe('hot'));

    const next = vi.fn().mockResolvedValue('warm');
    rerender({ f: next });

    // The old rows belong to the old filter; showing them under the new one
    // would be wrong, not merely stale.
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.data).toBe('warm'));
  });

  it('ignores a slow response from the filter that was replaced', async () => {
    const slow = deferred<string>();
    const first = vi.fn().mockReturnValue(slow.promise);
    const { result, rerender } = renderHook(({ f }) => usePolling(f), {
      initialProps: { f: first },
    });

    const second = vi.fn().mockResolvedValue('warm');
    rerender({ f: second });
    await waitFor(() => expect(result.current.data).toBe('warm'));

    // The first request finally answers, after its filter is gone. Without the
    // request-id guard this overwrites the current view with the wrong rows.
    await act(async () => {
      slow.resolve('hot');
      await slow.promise;
    });

    expect(result.current.data).toBe('warm');
  });
});

describe('refresh', () => {
  it('fetches immediately, for use after a write', async () => {
    const fetcher = vi.fn().mockResolvedValue('before');
    const { result } = renderHook(() => usePolling(fetcher));
    await waitFor(() => expect(result.current.data).toBe('before'));

    fetcher.mockResolvedValue('after');
    // So a claim shows at once rather than up to five seconds later.
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.data).toBe('after');
  });
});
