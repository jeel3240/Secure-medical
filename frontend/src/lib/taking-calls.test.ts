/**
 * The switch as the server holds it, taken from the browser's report - T15c,
 * AUTO-CALLS.md "Who is free".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PublicUser } from '../api/types';
import { useAuth } from '../auth/store';
import { markSwitchedHere, missedTransfer, switchMark, takeServerSwitch } from './taking-calls';

const MAYA: PublicUser = {
  id: 21,
  email: 'maya@example.com',
  name: 'Maya Chen',
  role: 'agent',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  takingCalls: true,
  takingCallsWhy: 'by_hand',
};
const MISSED = { takingCalls: false, takingCallsWhy: 'missed_transfer' } as const;

beforeEach(() => useAuth.setState({ status: 'authenticated', user: MAYA }));

describe('the server\'s word, from the report', () => {
  it('turned off for a missed transfer: the signed-in user says so', () => {
    takeServerSwitch(MISSED, switchMark());
    expect(useAuth.getState().user).toMatchObject(MISSED);
  });

  it('the same as here: the user is left as it is', () => {
    const before = useAuth.getState().user;
    takeServerSwitch({ takingCalls: true, takingCallsWhy: 'by_hand' }, switchMark());
    expect(useAuth.getState().user).toBe(before);
  });

  it('a report that crossed a switch made here is not taken - the switch\'s answer is newer', () => {
    const mark = switchMark();
    markSwitchedHere();
    takeServerSwitch(MISSED, mark);
    expect(useAuth.getState().user).toMatchObject({ takingCalls: true, takingCallsWhy: 'by_hand' });
  });

  it('signed out meanwhile: nothing', () => {
    useAuth.setState({ status: 'anonymous', user: null });
    takeServerSwitch(MISSED, switchMark());
    expect(useAuth.getState().user).toBeNull();
  });
});

describe('whether to say "Missed a transfer"', () => {
  it('only when off for that reason', () => {
    expect(missedTransfer(MISSED)).toBe(true);
    expect(missedTransfer({ takingCalls: true, takingCallsWhy: 'missed_transfer' })).toBe(false);
    expect(missedTransfer({ takingCalls: false, takingCallsWhy: 'sign_in' })).toBe(false);
    expect(missedTransfer({ takingCalls: false, takingCallsWhy: null })).toBe(false);
  });
});
