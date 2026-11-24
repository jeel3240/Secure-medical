/**
 * The robot placing its calls by itself - T20, AUTO-CALLS.md. The database and
 * Twilio are replaced: what is under test is the order of a look, and that it
 * never places more than there is room for.
 */
import { DEFAULT_CALL_HOURS } from '../core/auto-dial';
import { dialDueLeads, stopChange, worthLogging, type DialDeps } from './auto-calls';
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
      // One person free, two calls each: room for two.
      return { free: 1, perPerson: 2, underway: 0, onHold: false, silent: 0, scripted: true, refused: false };
    },
    leadsToCall,
    stillDue: async () => true,
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
    const open = { free: 3, perPerson: 5, underway: 0, onHold: false, silent: 0, scripted: true, refused: false };
    for (const [room, stopped] of [
      [{ ...open, free: 0 }, null],
      [{ ...open, underway: 15 }, null],
      [{ ...open, onHold: true }, 'on_hold'],
      [{ ...open, silent: 2 }, 'silent'],
      [{ ...open, refused: true }, 'refused'],
      [{ ...open, scripted: false }, 'no_script'],
    ] as const) {
      const { deps: d, leadsToCall } = deps({ dialRoom: async () => room });
      const look = await dialDueLeads(d, NOON);
      expect([look.room, look.stopped]).toEqual([0, stopped]);
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
      dialRoom: async () => ({ free: 5, perPerson: 5, underway: 0, onHold: false, silent: 0, scripted: true, refused: false }),
      placeAutoCall: async () => results.shift() ?? { kind: 'unconfirmed', callId: 4 },
      leadsToCall: async () => [1, 2, 3, 4],
    });
    expect(await dialDueLeads(d, NOON)).toMatchObject({ due: 4, placed: 1, refused: 1, failed: 1, unconfirmed: 1 });
  });

  it('Twilio refusing one for our account, or not answering: the look ends there - the next would go the same way', async () => {
    for (const stop of [{ kind: 'notPlaced', callId: 1 }, { kind: 'unconfirmed', callId: 1 }] as const) {
      const results: PlaceAutoCallResult[] = [{ kind: 'placed', callId: 9 }, stop];
      const placeAutoCall = jest.fn(async (): Promise<PlaceAutoCallResult> => results.shift() ?? { kind: 'placed', callId: 2 });
      const { deps: d } = deps({
        dialRoom: async () => ({ free: 5, perPerson: 5, underway: 0, onHold: false, silent: 0, scripted: true, refused: false }),
        leadsToCall: async () => [1, 2, 3, 4],
        placeAutoCall,
      });
      const look = await dialDueLeads(d, NOON);
      expect(placeAutoCall).toHaveBeenCalledTimes(2);
      expect(look).toMatchObject({ due: 4, placed: 1, [stop.kind]: 1 });
    }
  });

  it('each lead asked again just before its call - one that replied or was picked up meanwhile is skipped', async () => {
    const { deps: d, placeAutoCall } = deps({ stillDue: async ({ leadId }) => leadId !== 101 });
    const look = await dialDueLeads(d, NOON);
    expect(placeAutoCall.mock.calls.map(([id]) => id)).toEqual([102]);
    expect(look).toMatchObject({ due: 2, skipped: 1, placed: 1 });
  });

  it('another worker dialling: nothing looked up here', async () => {
    const { deps: d, leadsToCall, order } = deps({ withDialLock: async () => null });
    const look = await dialDueLeads(d, NOON);
    expect(look.locked).toBe(true);
    expect(order).toEqual(['close', 'since']);
    expect(leadsToCall).not.toHaveBeenCalled();
  });

  it('logged only when something happened - not every half minute', () => {
    const quiet = {
      closed: 0,
      inside: true,
      room: 2,
      stopped: null,
      silent: 0,
      due: 0,
      skipped: 0,
      placed: 0,
      refused: 0,
      failed: 0,
      notPlaced: 0,
      unconfirmed: 0,
      locked: false,
      aiError: null,
    };
    expect(worthLogging(quiet)).toBe(false);
    expect(worthLogging({ ...quiet, due: 1, placed: 1 })).toBe(true);
    expect(worthLogging({ ...quiet, closed: 1 })).toBe(true);
    expect(worthLogging({ ...quiet, locked: true })).toBe(true);
  });
});

describe('Seri asked about first (A17)', () => {
  it('ready: the calls go out as before', async () => {
    const seriReady = jest.fn(async () => ({ state: 'ready' as const }));
    const { deps: d, placeAutoCall } = deps({ seriReady });
    const look = await dialDueLeads(d, NOON);
    expect(placeAutoCall).toHaveBeenCalledTimes(2);
    expect(look).toMatchObject({ stopped: null, placed: 2, aiError: null });
  });

  it('OpenAI down: nothing placed this look, nothing even looked up - and why', async () => {
    const seriReady = async () => ({ state: 'openai_down' as const, err: 'OpenAI 401 invalid_api_key' });
    const { deps: d, leadsToCall, placeAutoCall } = deps({ seriReady });
    const look = await dialDueLeads(d, NOON);
    expect(look).toMatchObject({ stopped: 'openai_down', room: 0, aiError: 'OpenAI 401 invalid_api_key', placed: 0 });
    expect(leadsToCall).not.toHaveBeenCalled();
    expect(placeAutoCall).not.toHaveBeenCalled();
  });

  it('back up: the next look places again', async () => {
    let state: 'openai_down' | 'ready' = 'openai_down';
    const seriReady = async () => (state === 'ready' ? { state } : { state, err: 'OpenAI timed out' });
    const { deps: d, placeAutoCall } = deps({ seriReady });
    expect((await dialDueLeads(d, NOON)).placed).toBe(0);
    state = 'ready';
    expect((await dialDueLeads(d, NOON)).placed).toBe(2);
    expect(placeAutoCall).toHaveBeenCalledTimes(2);
  });

  it('her last three calls fell back: paused, nothing placed', async () => {
    const { deps: d, placeAutoCall } = deps({ seriReady: async () => ({ state: 'fallbacks' as const }) });
    const look = await dialDueLeads(d, NOON);
    expect(look).toMatchObject({ stopped: 'ai_fallbacks', room: 0, placed: 0 });
    expect(placeAutoCall).not.toHaveBeenCalled();
  });

  it('off: the calls go out - the script needs no OpenAI', async () => {
    const { deps: d, placeAutoCall } = deps({ seriReady: async () => ({ state: 'off' as const }) });
    expect((await dialDueLeads(d, NOON)).placed).toBe(2);
    expect(placeAutoCall).toHaveBeenCalledTimes(2);
  });

  it('not asked when there is no room, nor outside the hours - OpenAI is not checked to place nothing', async () => {
    const seriReady = jest.fn(async () => ({ state: 'ready' as const }));
    const full = deps({
      seriReady,
      dialRoom: async () => ({ free: 0, perPerson: 5, underway: 0, onHold: false, silent: 0, scripted: true, refused: false }),
    });
    await dialDueLeads(full.deps, NOON);
    await dialDueLeads(deps({ seriReady }).deps, EARLY);
    expect(seriReady).not.toHaveBeenCalled();
  });
});

describe('a stop logged once when it starts and once when it ends', () => {
  it('a new stop, and dialling again, are changes; the same stop again is not', () => {
    expect(stopChange(null, { stopped: 'silent', room: 0 })).toEqual({ now: 'silent' });
    expect(stopChange('silent', { stopped: 'silent', room: 0 })).toBeNull();
    expect(stopChange('silent', { stopped: null, room: 2 })).toEqual({ now: null });
  });

  it('waiting on hold is no stop', () => {
    expect(stopChange(null, { stopped: 'on_hold', room: 0 })).toBeNull();
  });

  it('OpenAI down: a look with no room says nothing about Seri - the stop stands until she is asked again (A17)', () => {
    expect(stopChange(null, { stopped: 'openai_down', room: 0 })).toEqual({ now: 'openai_down' });
    expect(stopChange('openai_down', { stopped: null, room: 0 })).toBeNull();
    expect(stopChange('ai_fallbacks', { stopped: null, room: 0 })).toBeNull();
    expect(stopChange('openai_down', { stopped: null, room: 3 })).toEqual({ now: null });
  });

  it('another stop while she was down is still a change', () => {
    expect(stopChange('openai_down', { stopped: 'refused', room: 0 })).toEqual({ now: 'refused' });
  });
});
