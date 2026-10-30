/**
 * The "Taking calls" switch in the app bar - T10, AUTO-CALLS.md "Who is free";
 * and the notice when the server turned it off for a missed transfer (T15c).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser } from '../api/types';
import { useAuth } from '../auth/store';
import { TakingCalls } from './TakingCalls';

const getCallConfig = vi.fn();
const setTakingCalls = vi.fn();
vi.mock('../api/calls', () => ({
  getCallConfig: () => getCallConfig(),
  setTakingCalls: (on: boolean) => setTakingCalls(on),
}));

const MAYA: PublicUser = {
  id: 21,
  email: 'maya@example.com',
  name: 'Maya Chen',
  role: 'agent',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  takingCalls: false,
  takingCallsWhy: 'sign_in',
};
const ON = { enabled: true, callerId: '+14804708259', autoCalls: true };

beforeEach(() => {
  getCallConfig.mockReset().mockResolvedValue(ON);
  setTakingCalls.mockReset().mockImplementation(async (on: boolean) => ({ takingCalls: on, takingCallsWhy: 'by_hand' }));
  useAuth.setState({ status: 'authenticated', user: MAYA });
});

async function shown() {
  render(<TakingCalls />);
  return screen.findByRole('switch', { name: 'Taking calls' });
}

describe('when it shows', () => {
  it('with automated calls on: off to begin with, as the server holds it', async () => {
    const toggle = await shown();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.title).toBe('You will not be rung for a transfer.');
  });

  it.each([
    ['automated calls are off', { ...ON, autoCalls: false }],
    ['calling is not set up', { enabled: false, callerId: null, autoCalls: false }],
  ])('not at all when %s', async (_, config) => {
    getCallConfig.mockResolvedValue(config);
    render(<TakingCalls />);
    await act(async () => undefined);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('not when the config cannot be read - a switch that cannot be saved is worse than none', async () => {
    getCallConfig.mockRejectedValue(new Error('offline'));
    render(<TakingCalls />);
    await act(async () => undefined);
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('switching it', () => {
  it('on, then off: saved, then shown - and the signed-in user says so', async () => {
    const toggle = await shown();
    fireEvent.click(toggle);
    expect(setTakingCalls).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(useAuth.getState().user?.takingCalls).toBe(true);
    expect(toggle.title).toBe('You can be rung for a transfer.');

    fireEvent.click(toggle);
    expect(setTakingCalls).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('flips only once the server has it, and takes no second click meanwhile', async () => {
    let answer: (on: boolean) => void = () => undefined;
    setTakingCalls.mockImplementation(
      () => new Promise((resolve) => (answer = (on) => resolve({ takingCalls: on, takingCallsWhy: 'by_hand' })))
    );
    const toggle = await shown();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(setTakingCalls).toHaveBeenCalledTimes(1);

    await act(async () => answer(true));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
  });

  it('a failure leaves it as it was, and says so', async () => {
    setTakingCalls.mockRejectedValue(new Error('offline'));
    const toggle = await shown();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.title).toBe('Could not switch it. Try again.'));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(useAuth.getState().user?.takingCalls).toBe(false);
  });
});

describe('turned off for a missed transfer (T15c)', () => {
  const NOTICE = 'Missed a transfer · Taking calls off';

  it('says so beside the switch, which is off', async () => {
    useAuth.setState({ status: 'authenticated', user: { ...MAYA, takingCallsWhy: 'missed_transfer' } });
    const toggle = await shown();
    expect(screen.getByRole('status').textContent).toBe(NOTICE);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('gone once switched on again', async () => {
    useAuth.setState({ status: 'authenticated', user: { ...MAYA, takingCallsWhy: 'missed_transfer' } });
    const toggle = await shown();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(useAuth.getState().user?.takingCallsWhy).toBe('by_hand');
  });

  it('not for any other reason it is off', async () => {
    for (const why of ['sign_in', 'sign_out', 'by_hand', null] as const) {
      useAuth.setState({ status: 'authenticated', user: { ...MAYA, takingCallsWhy: why } });
      const { unmount } = render(<TakingCalls />);
      await screen.findByRole('switch');
      expect(screen.queryByText(NOTICE)).toBeNull();
      unmount();
    }
  });
});
