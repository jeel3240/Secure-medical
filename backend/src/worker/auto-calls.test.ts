/**
 * The robot placing its calls by itself - T20, AUTO-CALLS.md. The database and
 * Twilio are replaced: what is under test is the order of a look, and that it
 * never places more than there is room for.
 */
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { dialDueLeads, worthLogging, type DialDeps } from './auto-calls';
import type { PlaceAutoCallResult } from './place-auto-call';

// Monday 2026-10-26, 12:00 in Arizona; and 10:00, before the hours.
const NOON = new Date('2026-10-26T19:00:00Z');
const EARLY = new Date('2026-10-26T17:00:00Z');
const SINCE = new Date('2026-10-20T00:00:00Z');

function deps(over: Partial<DialDeps> = {}) {
  const order: string[] = [];
  const leadsToCall = jest.fn(async (opts: { limit: number }) => [101, 102, 103].slice(0, opts.limit));
  const placeAutoCall = jest.fn(async (leadId: number): Promise<PlaceAutoCallResult> => ({ kind: 'placed', callId: leadId + 1000 }));
  const d: DialDeps = {
    closeUnplacedCalls: async () => {
      order.push('close');
      return 0;
    },
    autoCallsSince: async () => {
      order.push('since');
      return SINCE;
    },
    readCallHours: async () => DEFAULT_CALL_HOURS,
    dialRoom: async () => {
      order.push('room');
      return { free: 2, underway: 0, onHold: false };
    },
    leadsToCall,
    placeAutoCall,
    withDialLock: async (look) => look(),
    ...over,
  };
  return { deps: d, order, leadsToCall, placeAutoCall };
}

describe('one look', () => {
  it('closes calls that never reached Twilio, notes when calls were switched on, then dials - in that order', async () => {
    const { deps: d, order } = deps();
    await dialDueLeads(d, NOON);
    expect(order).toEqual(['close', 'since', 'room']);
  });

  it('outside the calling hours: closes and notes, places nothing', async () => {
    const { deps: d, order, leadsToCall, placeAutoCall } = deps();
    const look = await dialDueLeads(d, EARLY);
    expect(look.inside).toBe(false);
    expect(order).toEqual(['close', 'since']);
    expect(leadsToCall).not.toHaveBeenCalled();
    expect(placeAutoCall).not.toHaveBeenCalled();
  });

  it('never more calls than there is room for - the leads asked for up to the room, oldest first', async () => {
    const { deps: d, leadsToCall, placeAutoCall } = deps();
    const look = await dialDueLeads(d, NOON);
    expect(leadsToCall).toHaveBeenCalledWith({ now: NOON, since: SINCE, waitMinutes: 60, limit: 2 });
    expect(placeAutoCall.mock.calls.map(([id]) => id)).toEqual([101, 102]);
    expect(look).toMatchObject({ inside: true, room: 2, due: 2, placed: 2 });
  });

  it('no room - nobody free, or a lead on hold: no lead is even looked up', async () => {
    for (const room of [
      { free: 0, underway: 0, onHold: false },
      { free: 3, underway: 3, onHold: false },
      { free: 3, underway: 0, onHold: true },
    ]) {
      const { deps: d, leadsToCall } = deps({ dialRoom: async () => room });
      const look = await dialDueLeads(d, NOON);
      expect(look.room).toBe(0);
      expect(leadsToCall).not.toHaveBeenCalled();
    }
  });

  it('every call\'s end counted: placed, refused, failed, unconfirmed', async () => {
    const results: PlaceAutoCallResult[] = [
      { kind: 'placed', callId: 1 },
      { kind: 'refused', reason: 'blocked' },
      { kind: 'failed', callId: 3 },
    ];
    const { deps: d } = deps({
      dialRoom: async () => ({ free: 5, underway: 0, onHold: false }),
      placeAutoCall: async () => results.shift() ?? { kind: 'unconfirmed', callId: 4 },
      leadsToCall: async () => [1, 2, 3, 4],
    });
    expect(await dialDueLeads(d, NOON)).toMatchObject({ due: 4, placed: 1, refused: 1, failed: 1, unconfirmed: 1 });
  });

  it('another worker dialling: nothing looked up here', async () => {
    const { deps: d, leadsToCall, order } = deps({ withDialLock: async () => null });
    const look = await dialDueLeads(d, NOON);
    expect(look.locked).toBe(true);
    expect(order).toEqual(['close', 'since']);
    expect(leadsToCall).not.toHaveBeenCalled();
  });

  it('logged only when something happened - not every half minute', () => {
    const quiet = { closed: 0, inside: true, room: 2, due: 0, placed: 0, refused: 0, failed: 0, unconfirmed: 0, locked: false };
    expect(worthLogging(quiet)).toBe(false);
    expect(worthLogging({ ...quiet, due: 1, placed: 1 })).toBe(true);
    expect(worthLogging({ ...quiet, closed: 1 })).toBe(true);
    expect(worthLogging({ ...quiet, locked: true })).toBe(true);
  });
});
