/**
 * Seri's switch on Admin > Configuration's Calls tab - Jeel, 2026-11-24: what
 * the card says in each state, and that the button asks first, then switches
 * and shows the new state.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminConfig } from '../../api/admin';

let config: AdminConfig;
const setAiAgent = vi.fn(async (on: boolean) => {
  config = { ...config, aiAgent: { ...config.aiAgent, on } };
  return { on, changed: true };
});
vi.mock('../../api/admin', () => ({
  getConfig: async () => config,
  setAiAgent: (on: boolean) => setAiAgent(on),
}));

const { ConfigPage, seriState } = await import('./ConfigPage');

function makeConfig(aiAgent: AdminConfig['aiAgent'], autoCalls = true): AdminConfig {
  return {
    messages: [],
    scoring: { awards: [], questions: [], maxScore: 0 },
    flow: null,
    tiers: [],
    settings: { expiryDays: 7, maxInvalidBeforeReview: 1, segmentLimit: 160 },
    longestFirstName: 'there',
    longestNameIsFallback: true,
    callScript: null,
    callSettings: {
      on: autoCalls,
      startMinute: 660,
      endMinute: 1020,
      timeZone: 'America/Phoenix',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      waitMinutes: 60,
      ringSeconds: 25,
      offerRingSeconds: 20,
      holdMaxMinutes: 10,
      minConfidence: 0.4,
      callsPerPerson: 5,
      callbackNumber: null,
    },
    aiAgent,
  };
}

const showCalls = () =>
  render(
    <MemoryRouter initialEntries={['/admin/config?tab=calls']}>
      <ConfigPage />
    </MemoryRouter>
  );

beforeEach(() => {
  setAiAgent.mockClear();
});

describe("what Seri's card says", () => {
  it('on, with her key and robot calls on: the calls go to her', () => {
    expect(seriState({ on: true, keySet: true }, true)).toEqual({ label: 'On', note: 'Robot calls go to Seri.', canSwitchOn: true });
  });

  it('off: the calls use the script', () => {
    expect(seriState({ on: false, keySet: true }, true)).toEqual({ label: 'Off', note: 'Robot calls use the script.', canSwitchOn: true });
  });

  it('no key: she cannot be switched on, and on without one is the script', () => {
    expect(seriState({ on: false, keySet: false }, true)).toMatchObject({ canSwitchOn: false, note: 'OPENAI_API_KEY is not set on the server.' });
    expect(seriState({ on: true, keySet: false }, true).note).toMatch(/calls get the script/);
  });

  it('robot calls off: no call goes to her either way', () => {
    expect(seriState({ on: true, keySet: true }, false).note).toMatch(/Automated calls are off/);
  });
});

describe("Seri's switch on the Calls tab", () => {
  it('asks first, then switches her on and shows it', async () => {
    config = makeConfig({ on: false, keySet: true });
    showCalls();
    fireEvent.click(await screen.findByRole('button', { name: 'Switch on' }));
    expect(screen.getByText('Switch Seri on?')).toBeTruthy();
    expect(setAiAgent).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Switch on')!);
    await waitFor(() => expect(setAiAgent).toHaveBeenCalledWith(true));
    await screen.findByRole('button', { name: 'Switch off' });
    expect(screen.getByText('Robot calls go to Seri.')).toBeTruthy();
  });

  it('Cancel changes nothing', async () => {
    config = makeConfig({ on: true, keySet: true });
    showCalls();
    fireEvent.click(await screen.findByRole('button', { name: 'Switch off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(setAiAgent).not.toHaveBeenCalled();
    expect(screen.queryByText('Switch Seri off?')).toBeNull();
  });

  it('with no key, Switch on cannot be pressed', async () => {
    config = makeConfig({ on: false, keySet: false });
    showCalls();
    expect(((await screen.findByRole('button', { name: 'Switch on' })) as HTMLButtonElement).disabled).toBe(true);
  });
});
