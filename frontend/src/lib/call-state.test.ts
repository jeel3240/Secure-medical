import { describe, expect, it } from 'vitest';
import { callBlockedReason, callClock, callReducer, endedText, IDLE, isActive, type CallEvent, type CallState } from './call-state';

const run = (events: CallEvent[], from: CallState = IDLE) => events.reduce(callReducer, from);
const T0 = 1_000_000;

describe('a call from start to end', () => {
  it('connects, rings, goes live, and ends with its length', () => {
    expect(run([{ type: 'start' }])).toEqual({ phase: 'connecting' });
    expect(run([{ type: 'start' }, { type: 'ringing' }])).toEqual({ phase: 'ringing' });
    const live = run([{ type: 'start' }, { type: 'ringing' }, { type: 'answered', at: T0 }]);
    expect(live).toEqual({ phase: 'live', since: T0, muted: false });
    expect(callReducer(live, { type: 'ended', at: T0 + 134_400, byAgent: true })).toEqual({
      phase: 'ended',
      result: 'talked',
      seconds: 134,
    });
  });

  it('answered straight from connecting, when no ringing event arrived', () => {
    expect(run([{ type: 'start' }, { type: 'answered', at: T0 }]).phase).toBe('live');
  });

  it('never answered: cancelled if the agent hung up, no answer if it rang out', () => {
    const ringing = run([{ type: 'start' }, { type: 'ringing' }]);
    expect(callReducer(ringing, { type: 'ended', at: T0, byAgent: true })).toEqual({ phase: 'ended', result: 'canceled' });
    expect(callReducer(ringing, { type: 'ended', at: T0, byAgent: false })).toEqual({ phase: 'ended', result: 'no_answer' });
  });

  it('mutes only while live', () => {
    const live = run([{ type: 'start' }, { type: 'answered', at: T0 }]);
    expect(callReducer(live, { type: 'muted', muted: true })).toMatchObject({ phase: 'live', muted: true });
    expect(run([{ type: 'start' }, { type: 'muted', muted: true }])).toEqual({ phase: 'connecting' });
  });
});

describe('what cannot happen', () => {
  it('a second call does not start while one is in flight', () => {
    const live = run([{ type: 'start' }, { type: 'answered', at: T0 }]);
    expect(callReducer(live, { type: 'start' })).toBe(live);
    expect(isActive(live)).toBe(true);
  });

  it('a failure stays a failure when the hang-up that follows it arrives', () => {
    const failed = run([{ type: 'start' }, { type: 'failed', message: 'No microphone.' }]);
    expect(callReducer(failed, { type: 'ended', at: T0, byAgent: false })).toEqual({ phase: 'failed', message: 'No microphone.' });
  });

  it('reset clears a finished call, never a live one', () => {
    expect(run([{ type: 'start' }, { type: 'ended', at: T0, byAgent: true }, { type: 'reset' }])).toEqual(IDLE);
    const live = run([{ type: 'start' }, { type: 'answered', at: T0 }]);
    expect(callReducer(live, { type: 'reset' })).toBe(live);
  });

  it('a new call can start after one ended or failed', () => {
    expect(run([{ type: 'start' }, { type: 'failed', message: 'x' }, { type: 'start' }])).toEqual({ phase: 'connecting' });
  });
});

describe('in words', () => {
  it.each([
    [7, '0:07'],
    [134, '2:14'],
    [3725, '1:02:05'],
    [-3, '0:00'],
  ])('%i seconds is %s', (seconds, text) => {
    expect(callClock(seconds)).toBe(text);
  });

  it('says how a call ended', () => {
    expect(endedText({ phase: 'ended', result: 'talked', seconds: 134 })).toBe('Call ended · 2:14');
    expect(endedText({ phase: 'ended', result: 'no_answer' })).toBe('No answer');
    expect(endedText({ phase: 'ended', result: 'canceled' })).toBe('Call cancelled');
  });

  it('says why the button is off, the do-not-call list first', () => {
    expect(callBlockedReason({ enabled: true, holdsLead: true, onDncList: false })).toBeNull();
    expect(callBlockedReason({ enabled: true, holdsLead: true, onDncList: true })).toMatch(/do-not-call/);
    expect(callBlockedReason({ enabled: false, holdsLead: true, onDncList: false })).toMatch(/not set up/);
    expect(callBlockedReason({ enabled: null, holdsLead: true, onDncList: false })).toMatch(/Checking/);
    expect(callBlockedReason({ enabled: true, holdsLead: false, onDncList: false })).toMatch(/Pick up/);
  });
});
