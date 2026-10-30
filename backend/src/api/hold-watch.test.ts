/**
 * The hold watcher, and offering a lead on hold to whoever comes free - T16
 * and T17, AUTO-CALLS.md "The hold line". The database and Twilio are
 * replaced: what is under test is who is offered, who is sent back to
 * `/auto/hold`, and in what order.
 */
import type { Offer } from '../db/hold-offers';
import { checkHolds, offerWaiting, watchHolds, type HoldWatchDeps } from './hold-watch';

type Waiting = { callId: number; callSid: string; waitedSeconds: number; offerLive: boolean };

function deps(over: Partial<HoldWatchDeps> = {}) {
  const recheckHold = jest.fn<Promise<boolean>, [string, number]>().mockResolvedValue(true);
  const startOffer = jest.fn<Promise<Offer | null>, [number | null]>().mockResolvedValue(null);
  const sendToOffer = jest.fn<Promise<boolean>, [Offer]>().mockResolvedValue(true);
  const endOffer = jest.fn().mockResolvedValue(16);
  const endStaleOffers = jest.fn().mockResolvedValue(0);
  const closeIfOver = jest.fn<Promise<boolean>, [string, number]>().mockResolvedValue(false);
  const d: HoldWatchDeps = {
    endStaleOffers,
    startOffer,
    sendToOffer,
    endOffer,
    callsOnHold: async () => [
      { callId: 42, callSid: 'CA42', waitedSeconds: 30, offerLive: false },
      { callId: 43, callSid: 'CA43', waitedSeconds: 650, offerLive: false },
    ],
    someoneComing: async () => true,
    readHoldMaxSeconds: async () => 600,
    recheckHold,
    closeIfOver,
    ...over,
  };
  return { deps: d, recheckHold, startOffer, sendToOffer, endOffer, endStaleOffers, closeIfOver };
}

const offer = (callId: number, agentId: number, offerId = 7): Offer => ({ offerId, callId, callSid: `CA${callId}`, agentId });

describe('offering a lead on hold (T17)', () => {
  it('everyone free is offered a lead, longest waiting first, until nothing is left', async () => {
    const { deps: d, startOffer, sendToOffer } = deps();
    startOffer.mockResolvedValueOnce(offer(42, 16, 7)).mockResolvedValueOnce(offer(43, 19, 8)).mockResolvedValueOnce(null);
    expect(await offerWaiting(d)).toBe(2);
    expect(startOffer.mock.calls).toEqual([[null], [null], [null]]);
    expect(sendToOffer.mock.calls.map(([o]) => [o.callId, o.agentId])).toEqual([
      [42, 16],
      [43, 19],
    ]);
  });

  it('the person who has just come free: one offer, to them alone', async () => {
    const { deps: d, startOffer } = deps();
    startOffer.mockResolvedValue(offer(42, 19));
    expect(await offerWaiting(d, 19)).toBe(1);
    expect(startOffer.mock.calls).toEqual([[19]]);
  });

  it('Twilio not taking the redirect: the offer ended unsent - never made again to them', async () => {
    const { deps: d, startOffer, sendToOffer, endOffer } = deps();
    startOffer.mockResolvedValueOnce(offer(42, 16, 7)).mockResolvedValueOnce(null);
    sendToOffer.mockResolvedValue(false);
    expect(await offerWaiting(d)).toBe(0);
    expect(endOffer).toHaveBeenCalledWith(42, 7, 'unsent');
  });
});

describe('one look', () => {
  it('stale offers ended, then offers made, before anyone is sent to the busy line', async () => {
    const order: string[] = [];
    const { deps: d, endStaleOffers, startOffer } = deps({
      callsOnHold: async () => {
        order.push('holds');
        return [];
      },
    });
    endStaleOffers.mockImplementation(async () => {
      order.push('stale');
      return 0;
    });
    startOffer.mockImplementation(async () => {
      order.push('offer');
      return null;
    });
    await checkHolds(d);
    expect(order).toEqual(['stale', 'offer', 'holds']);
  });

  it('nobody waiting: nothing sent', async () => {
    const someoneComing = jest.fn(async () => true);
    const { deps: d, recheckHold } = deps({ callsOnHold: async () => [], someoneComing });
    expect(await checkHolds(d)).toBe(0);
    expect(someoneComing).not.toHaveBeenCalled();
    expect(recheckHold).not.toHaveBeenCalled();
  });

  it('someone still coming: only who has waited the safety stop\'s length is sent back', async () => {
    const { deps: d, recheckHold } = deps();
    expect(await checkHolds(d)).toBe(1);
    expect(recheckHold.mock.calls).toEqual([['CA43', 43]]);
  });

  it('nobody coming any more: every lead waiting is sent back', async () => {
    const { deps: d, recheckHold } = deps({ someoneComing: async () => false });
    expect(await checkHolds(d)).toBe(2);
    expect(recheckHold.mock.calls).toEqual([
      ['CA42', 42],
      ['CA43', 43],
    ]);
  });

  it('a lead ringing someone who came free is left alone - the ring decides', async () => {
    const someoneComing = jest.fn(async () => false);
    const { deps: d, recheckHold } = deps({
      someoneComing,
      callsOnHold: async (): Promise<Waiting[]> => [{ callId: 42, callSid: 'CA42', waitedSeconds: 900, offerLive: true }],
    });
    expect(await checkHolds(d)).toBe(0);
    expect(someoneComing).not.toHaveBeenCalled();
    expect(recheckHold).not.toHaveBeenCalled();
  });

  it('Twilio refusing one is not counted, and the others are still sent', async () => {
    const { deps: d, recheckHold } = deps({ someoneComing: async () => false });
    recheckHold.mockResolvedValueOnce(false);
    expect(await checkHolds(d)).toBe(1);
    expect(recheckHold).toHaveBeenCalledTimes(2);
  });

  it('a call Twilio refused is asked about - over, its end report lost: ended here, never on hold for ever (T20 review)', async () => {
    const { deps: d, recheckHold, closeIfOver } = deps({ someoneComing: async () => false });
    recheckHold.mockResolvedValueOnce(false);
    closeIfOver.mockResolvedValue(true);
    await checkHolds(d);
    expect(closeIfOver.mock.calls).toEqual([['CA42', 42]]);
  });

  it('a call Twilio took is never asked about', async () => {
    const { deps: d, closeIfOver } = deps({ someoneComing: async () => false });
    await checkHolds(d);
    expect(closeIfOver).not.toHaveBeenCalled();
  });
});

describe('looking every half minute', () => {
  afterEach(() => jest.useRealTimers());

  it('looks on each tick, one look at a time, and stops when told', async () => {
    jest.useFakeTimers();
    let release: () => void = () => undefined;
    const callsOnHold = jest.fn(() => new Promise<Waiting[]>((resolve) => (release = () => resolve([]))));
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
