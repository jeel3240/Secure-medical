import { describe, expect, it } from 'vitest';
import { incomingReducer, isBusy, NO_CALL, type IncomingEvent, type IncomingState } from './incoming-state';

const PRIYA = { id: 7, name: 'Priya Sharma', phone: '+15550100016' };
const SAM = { id: 8, name: 'Sam Lee', phone: '+15550100017' };

const run = (events: IncomingEvent[], from: IncomingState = NO_CALL) => events.reduce(incomingReducer, from);
const ring: IncomingEvent = { type: 'ring', caller: PRIYA, at: 0 };
const rangOut: IncomingEvent = { type: 'ring_over', at: 20_400 };
const answered: IncomingEvent = { type: 'call', event: { type: 'answered', at: 1_000 } };
const ended: IncomingEvent = { type: 'call', event: { type: 'ended', at: 43_000, byAgent: true } };

describe('a lead calling in', () => {
  it('rings, saying who it is', () => {
    expect(run([ring])).toEqual({ phase: 'ringing', caller: PRIYA, since: 0 });
  });

  it('not picked up: a missed call, which stays until it is dismissed', () => {
    const missed = run([ring, rangOut]);
    expect(missed).toEqual({ phase: 'missed', caller: PRIYA, rangSeconds: 20 });
    expect(run([{ type: 'call', event: { type: 'reset' } }], missed)).toBe(missed);
    expect(run([{ type: 'dismiss' }], missed)).toBe(NO_CALL);
  });

  it('declined: gone, and not shown as missed - the agent chose it', () => {
    expect(run([ring, { type: 'declined' }])).toBe(NO_CALL);
  });

  it('answered: an ordinary call, timed from the moment it connects', () => {
    expect(run([ring, { type: 'answer' }])).toEqual({ phase: 'call', caller: PRIYA, call: { phase: 'connecting' } });
    expect(run([ring, { type: 'answer' }, answered])).toMatchObject({ call: { phase: 'live', since: 1_000 } });
  });

  it('then over: the note box, until it is saved or skipped', () => {
    const over = run([ring, { type: 'answer' }, answered, ended]);
    expect(over).toMatchObject({ phase: 'call', call: { phase: 'ended', result: 'talked', seconds: 42 } });
    expect(run([{ type: 'call', event: { type: 'reset' } }], over)).toBe(NO_CALL);
  });

  it('the ring ending after it was answered is not a missed call', () => {
    const live = run([ring, { type: 'answer' }, answered]);
    expect(run([rangOut], live)).toBe(live);
  });
});

describe('one call at a time', () => {
  it('a second caller is not shown while the first is ringing or being spoken to', () => {
    const second: IncomingEvent = { type: 'ring', caller: SAM, at: 5 };
    expect(run([ring, second])).toMatchObject({ phase: 'ringing', caller: PRIYA });
    expect(run([ring, { type: 'answer' }, answered, second])).toMatchObject({ phase: 'call', caller: PRIYA });
  });

  it('but takes the place of a missed call, or a finished call’s note box', () => {
    const second: IncomingEvent = { type: 'ring', caller: SAM, at: 5 };
    expect(run([ring, rangOut, second])).toEqual({ phase: 'ringing', caller: SAM, since: 5 });
    expect(run([ring, { type: 'answer' }, answered, ended, second])).toEqual({ phase: 'ringing', caller: SAM, since: 5 });
  });

  it('busy means ringing or talking - not missed, not the note box', () => {
    expect(isBusy(NO_CALL)).toBe(false);
    expect(isBusy(run([ring]))).toBe(true);
    expect(isBusy(run([ring, { type: 'answer' }, answered]))).toBe(true);
    expect(isBusy(run([ring, rangOut]))).toBe(false);
    expect(isBusy(run([ring, { type: 'answer' }, answered, ended]))).toBe(false);
  });
});

describe('events with nothing to act on change nothing', () => {
  it.each<IncomingEvent>([rangOut, { type: 'declined' }, { type: 'answer' }, answered, { type: 'dismiss' }])(
    '$type with no call',
    (event) => {
      expect(incomingReducer(NO_CALL, event)).toBe(NO_CALL);
    }
  );
});
