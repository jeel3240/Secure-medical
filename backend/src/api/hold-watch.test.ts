/**
 * The hold watcher - T16, AUTO-CALLS.md "The hold line". The database and
 * Twilio are replaced: what is under test is who is sent back to `/auto/hold`.
 */
import { checkHolds, watchHolds, type HoldWatchDeps } from './hold-watch';

function deps(over: Partial<HoldWatchDeps> = {}) {
  const recheckHold = jest.fn<Promise<boolean>, [string, number]>().mockResolvedValue(true);
  return {
    recheckHold,
    deps: {
      callsOnHold: async () => [
        { callId: 42, callSid: 'CA42', waitedSeconds: 30 },
        { callId: 43, callSid: 'CA43', waitedSeconds: 650 },
      ],
      someoneOnCall: async () => true,
      readHoldMaxSeconds: async () => 600,
      recheckHold,
      ...over,
    } satisfies HoldWatchDeps,
  };
}

describe('one look', () => {
  it('nobody waiting: nothing asked, nothing sent', async () => {
    const someoneOnCall = jest.fn(async () => true);
    const { deps: d, recheckHold } = deps({ callsOnHold: async () => [], someoneOnCall });
    expect(await checkHolds(d)).toBe(0);
    expect(someoneOnCall).not.toHaveBeenCalled();
    expect(recheckHold).not.toHaveBeenCalled();
  });

  it('someone still on a call: only who has waited the safety stop\'s length is sent back', async () => {
    const { deps: d, recheckHold } = deps();
    expect(await checkHolds(d)).toBe(1);
    expect(recheckHold.mock.calls).toEqual([['CA43', 43]]);
  });

  it('nobody on a call any more: every lead waiting is sent back - nobody is coming', async () => {
    const { deps: d, recheckHold } = deps({ someoneOnCall: async () => false });
    expect(await checkHolds(d)).toBe(2);
    expect(recheckHold.mock.calls).toEqual([
      ['CA42', 42],
      ['CA43', 43],
    ]);
  });

  it('Twilio refusing one is not counted, and the others are still sent', async () => {
    const { deps: d, recheckHold } = deps({ someoneOnCall: async () => false });
    recheckHold.mockResolvedValueOnce(false);
    expect(await checkHolds(d)).toBe(1);
    expect(recheckHold).toHaveBeenCalledTimes(2);
  });
});

describe('looking every half minute', () => {
  afterEach(() => jest.useRealTimers());

  it('looks on each tick, one look at a time, and stops when told', async () => {
    jest.useFakeTimers();
    let release: () => void = () => undefined;
    const callsOnHold = jest.fn(
      () => new Promise<{ callId: number; callSid: string; waitedSeconds: number }[]>((resolve) => (release = () => resolve([])))
    );
    const { deps: d } = deps({ callsOnHold });
    const stop = watchHolds(d, 30_000);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(callsOnHold).toHaveBeenCalledTimes(1);
    // Still looking: the next tick does not start a second look.
    await jest.advanceTimersByTimeAsync(30_000);
    expect(callsOnHold).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(callsOnHold).toHaveBeenCalledTimes(2);
    stop();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(callsOnHold).toHaveBeenCalledTimes(2);
  });

  it('a look that fails is logged, and the next one still comes', async () => {
    jest.useFakeTimers();
    const callsOnHold = jest.fn().mockRejectedValueOnce(new Error('database down')).mockResolvedValue([]);
    const { deps: d } = deps({ callsOnHold });
    const stop = watchHolds(d, 30_000);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(callsOnHold).toHaveBeenCalledTimes(2);
    stop();
  });
});
