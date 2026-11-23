/**
 * One lead's call on the workspace - `useLeadCall`, review Q7, 2026-11-23.
 *
 * The hardest call logic on the page had no test: Hang up before the call
 * exists, the call ending when the agent leaves the lead, no second call while
 * one is going, and the refresh after a call - once, then once more, never
 * twice over when a failure is followed by Twilio's disconnect.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallHandlers, CallHandle } from '../../lib/calling';

let events: CallHandlers | null = null;
let resolvePlaced: ((handle: CallHandle) => void) | null = null;
let rejectPlaced: ((err: unknown) => void) | null = null;
const handle = { hangUp: vi.fn(), setMuted: vi.fn(), sendDigits: vi.fn() };
const placeCall = vi.fn((_leadId: number, on: CallHandlers) => {
  events = on;
  return new Promise<CallHandle>((resolve, reject) => {
    resolvePlaced = resolve;
    rejectPlaced = reject;
  });
});

vi.mock('../../lib/calling', () => ({
  placeCall: (leadId: number, on: CallHandlers) => placeCall(leadId, on),
  describeCallError: () => 'Could not start the call.',
}));
vi.mock('../../lib/presence', () => ({ useBusyWhile: () => undefined }));

import { useLeadCall } from './useLeadCall';

const onOver = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  events = null;
  placeCall.mockClear();
  onOver.mockClear();
  handle.hangUp.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

async function placed(result: { current: ReturnType<typeof useLeadCall> }) {
  act(() => result.current.start());
  await act(async () => {
    resolvePlaced?.(handle as unknown as CallHandle);
  });
}

describe('a lead call on the workspace', () => {
  it('refreshes once when it ends, and once more a little later', async () => {
    const { result } = renderHook(() => useLeadCall(7, onOver));
    await placed(result);
    act(() => events?.onAnswered());
    act(() => events?.onEnded());

    expect(onOver).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe('ended');
    act(() => vi.advanceTimersByTime(2500));
    expect(onOver).toHaveBeenCalledTimes(2);
  });

  it('a failure followed by Twilio ending the call refreshes once, not twice over', async () => {
    const { result } = renderHook(() => useLeadCall(7, onOver));
    await placed(result);
    act(() => events?.onFailed('The call dropped.'));
    act(() => events?.onEnded());

    act(() => vi.advanceTimersByTime(2500));
    expect(onOver).toHaveBeenCalledTimes(2);
    // The failure stays on screen: the late end does not turn it into an ended call.
    expect(result.current.state).toEqual({ phase: 'failed', message: 'The call dropped.' });
  });

  it('Hang up pressed while it is still connecting ends it as soon as it exists', async () => {
    const { result } = renderHook(() => useLeadCall(7, onOver));
    act(() => result.current.start());
    act(() => result.current.hangUp());
    expect(handle.hangUp).not.toHaveBeenCalled();

    await act(async () => {
      resolvePlaced?.(handle as unknown as CallHandle);
    });
    expect(handle.hangUp).toHaveBeenCalledTimes(1);
  });

  it('a second Call while one is going places nothing', async () => {
    const { result } = renderHook(() => useLeadCall(7, onOver));
    await placed(result);
    act(() => result.current.start());
    expect(placeCall).toHaveBeenCalledTimes(1);
  });

  it('a new call can be placed once the last is over', async () => {
    const { result } = renderHook(() => useLeadCall(7, onOver));
    await placed(result);
    act(() => events?.onEnded());
    act(() => result.current.dismiss());
    await placed(result);
    expect(placeCall).toHaveBeenCalledTimes(2);
    act(() => events?.onEnded());
    expect(onOver).toHaveBeenCalledTimes(2);
  });

  it('leaving the lead ends its call', async () => {
    const { result, unmount } = renderHook(() => useLeadCall(7, onOver));
    await placed(result);
    unmount();
    expect(handle.hangUp).toHaveBeenCalledTimes(1);
  });

  it('a call that could not be placed says why, refreshes nothing, and Call works again', async () => {
    const { result } = renderHook(() => useLeadCall(7, onOver));
    act(() => result.current.start());
    await act(async () => {
      rejectPlaced?.(new Error('no token'));
    });
    expect(result.current.state).toEqual({ phase: 'failed', message: 'Could not start the call.' });
    expect(onOver).not.toHaveBeenCalled();

    act(() => result.current.dismiss());
    act(() => result.current.start());
    expect(placeCall).toHaveBeenCalledTimes(2);
  });
});
