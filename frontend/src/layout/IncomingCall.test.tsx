/**
 * A lead calling in: the card the agent sees while it rings - who it is, and
 * what we know about them - and the notice when nobody picked up. TWILIO.md,
 * "Incoming calls".
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallHandlers, IncomingHandlers, IncomingRing } from '../lib/calling';
import { useIncomingCall } from '../lib/incoming-call';
import { NO_CALL } from '../lib/incoming-state';
import { IncomingCall } from './IncomingCall';

const getCallConfig = vi.fn();
const claimLead = vi.fn();
const stop = vi.fn();
let twilio: IncomingHandlers | null = null;

vi.mock('../api/calls', () => ({ getCallConfig: () => getCallConfig() }));
vi.mock('../api/leads', () => ({ claimLead: (id: number) => claimLead(id) }));
const getLead = vi.fn();
const getTimeline = vi.fn();
vi.mock('../api/workspace', () => ({
  addNote: vi.fn(),
  getLead: (id: number) => getLead(id),
  getTimeline: (id: number) => getTimeline(id),
}));
const canRing = vi.fn(() => true);
const stopRinging = vi.fn();
const startRinging = vi.fn(() => stopRinging);
vi.mock('../lib/ringtone', () => ({
  canRing: () => canRing(),
  startRinging: () => startRinging(),
}));
vi.mock('../auth/store', () => ({
  useAuth: (pick: (s: unknown) => unknown) => pick({ user: { id: 21, name: 'Maya Chen' } }),
}));

const LEAD = {
  id: 7,
  conversation: { status: 'expired', step: 2, score: 45, tier: 'WARM', agentTookOverAt: null },
  chips: [{ question: 1, heading: 'Interest', answer: 'Both', choice: '3' }],
  claimedBy: null,
};
const aCall = (author: string) => ({ kind: 'call', at: new Date().toISOString(), author, detail: { direction: 'outbound', outcome: 'no_answer' } });
vi.mock('../lib/calling', () => ({
  describeCallError: () => 'It broke.',
  listenForCalls: (handlers: IncomingHandlers) => {
    twilio = handlers;
    return stop;
  },
}));

function aRing(lead = { id: 7, name: 'Priya Sharma', phone: '+15550100016' }) {
  let handlers: CallHandlers | null = null;
  const handle = { hangUp: vi.fn(), setMuted: vi.fn(), sendDigits: vi.fn() };
  const ring: IncomingRing = {
    lead,
    answer: vi.fn((given: CallHandlers) => {
      handlers = given;
      return handle;
    }),
    decline: vi.fn(),
  };
  return { ring, handle, events: () => handlers! };
}

function LeadPage() {
  const asked = (useLocation().state as { callBack?: boolean } | null)?.callBack;
  return <p>the lead’s page{asked ? ', dialling' : ''}</p>;
}

async function show() {
  const view = render(
    <MemoryRouter initialEntries={['/queue']}>
      <Routes>
        <Route path="/queue" element={<p>the queue</p>} />
        <Route path="/leads/:id" element={<LeadPage />} />
      </Routes>
      <IncomingCall />
    </MemoryRouter>
  );
  await waitFor(() => expect(twilio).not.toBeNull());
  return view;
}

beforeEach(() => {
  twilio = null;
  stop.mockReset();
  claimLead.mockReset().mockResolvedValue(undefined);
  getLead.mockReset().mockResolvedValue(LEAD);
  getTimeline.mockReset().mockResolvedValue([aCall('Maya Chen'), aCall('Maya Chen')]);
  getCallConfig.mockReset().mockResolvedValue({ enabled: true, callerId: '+14804708259' });
  useIncomingCall.setState({ state: NO_CALL, ringable: false });
  canRing.mockReset().mockReturnValue(true);
  startRinging.mockClear();
  stopRinging.mockClear();
});

describe('being ringable', () => {
  it('shows nothing until a call comes', async () => {
    await show();
    expect(screen.queryByText('Incoming call')).toBeNull();
  });

  it('does not listen at all when calling is not set up', async () => {
    getCallConfig.mockResolvedValue({ enabled: false, callerId: null });
    render(
      <MemoryRouter>
        <IncomingCall />
      </MemoryRouter>
    );
    await act(async () => undefined);
    expect(twilio).toBeNull();
  });

  it('stops when the agent signs out', async () => {
    const { unmount } = await show();
    unmount();
    expect(stop).toHaveBeenCalled();
  });
});

describe('a lead rings', () => {
  it('says who is calling, at once, with Accept and Decline', async () => {
    getLead.mockReturnValue(new Promise(() => undefined));
    getTimeline.mockReturnValue(new Promise(() => undefined));
    await show();
    act(() => twilio!.onRing(aRing().ring));
    expect(screen.getByText('Incoming call')).toBeDefined();
    expect(screen.getByText('Priya S.')).toBeDefined();
    expect(screen.getByText('(555) 010-0016')).toBeDefined();
    expect(screen.getByRole('timer').textContent).toBe('0:00');
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDefined();
  });

  it('then what we know about them: tier, score, interest, where the questions stopped, and our tries today', async () => {
    await show();
    act(() => twilio!.onRing(aRing().ring));
    await waitFor(() => expect(screen.getByText('45')).toBeDefined());
    expect(screen.getByText('/ 100')).toBeDefined();
    expect(screen.getByText('WARM')).toBeDefined();
    expect(screen.getByText('Both')).toBeDefined();
    expect(screen.getByText('Stopped at Q2')).toBeDefined();
    expect(screen.getByText('Calling back · you tried 2× today')).toBeDefined();
    expect(screen.getByText('Accepting opens Priya’s workspace and assigns the lead to you.')).toBeDefined();
  });

  it('does not say "assigns" for a lead the agent already holds', async () => {
    getLead.mockResolvedValue({ ...LEAD, claimedBy: { id: 21, name: 'Maya Chen', at: '' } });
    await show();
    act(() => twilio!.onRing(aRing().ring));
    await waitFor(() => expect(screen.getByText('Accepting opens Priya’s workspace.')).toBeDefined());
  });

  it('still rings when the details cannot be loaded', async () => {
    getLead.mockRejectedValue(new Error('offline'));
    getTimeline.mockRejectedValue(new Error('offline'));
    await show();
    act(() => twilio!.onRing(aRing().ring));
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDefined();
  });

  it('a lead with no name is shown by number', async () => {
    await show();
    act(() => twilio!.onRing(aRing({ id: 7, name: '', phone: '+15550100016' }).ring));
    expect(screen.getByText('(555) 010-0016')).toBeDefined();
  });

  it('Accept: picks up, takes the lead, opens its page, and shows the live call', async () => {
    await show();
    const { ring, events, handle } = aRing();
    act(() => twilio!.onRing(ring));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(ring.answer).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('the lead’s page')).toBeDefined());
    expect(claimLead).toHaveBeenCalledWith(7);

    act(() => events().onAnswered());
    expect(screen.getByRole('status').textContent).toBe('Connected');
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(handle.hangUp).toHaveBeenCalled();

    act(() => events().onEnded());
    expect(screen.getByLabelText('Note about this call')).toBeDefined();
  });

  it('Decline: the bar goes, and it is not called a missed call', async () => {
    await show();
    const { ring } = aRing();
    act(() => twilio!.onRing(ring));
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(ring.decline).toHaveBeenCalled();
    expect(screen.queryByText(/Incoming call|Missed call/)).toBeNull();
  });
});

describe('the ring', () => {
  it('sounds while the card is up, and stops when it is accepted', async () => {
    await show();
    act(() => twilio!.onRing(aRing().ring));
    expect(startRinging).toHaveBeenCalledTimes(1);
    expect(stopRinging).not.toHaveBeenCalled();
    expect(document.title).toBe('Incoming call');
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(stopRinging).toHaveBeenCalled();
    expect(document.title).not.toBe('Incoming call');
    await waitFor(() => expect(claimLead).toHaveBeenCalled());
  });

  it('stops when the call is missed', async () => {
    await show();
    const { ring } = aRing();
    act(() => twilio!.onRing(ring));
    act(() => twilio!.onRingOver(ring));
    expect(stopRinging).toHaveBeenCalled();
  });

  it('asks for a click while the browser is still blocking sound, and not after', async () => {
    canRing.mockReturnValue(false);
    await show();
    await waitFor(() => expect(screen.getByText('Call sound off · click to turn on')).toBeDefined());
    canRing.mockReturnValue(true);
    fireEvent.pointerDown(window);
    await waitFor(() => expect(screen.queryByText(/Call sound off/)).toBeNull());
  });
});

describe('nobody picked up', () => {
  it('says the call was missed, and stays until dismissed', async () => {
    await show();
    const { ring } = aRing();
    act(() => twilio!.onRing(ring));
    act(() => twilio!.onRingOver(ring));

    expect(screen.getByText('Missed call · Priya S.')).toBeDefined();
    expect(screen.getByText(/^Rang for \d+s$/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Missed call/)).toBeNull();
  });

  it('Call back: takes the lead and opens it, dialling', async () => {
    await show();
    const { ring } = aRing();
    act(() => twilio!.onRing(ring));
    act(() => twilio!.onRingOver(ring));
    fireEvent.click(screen.getByRole('button', { name: 'Call back' }));
    await waitFor(() => expect(screen.getByText('the lead’s page, dialling')).toBeDefined());
    expect(claimLead).toHaveBeenCalledWith(7);
    expect(screen.queryByText(/Missed call/)).toBeNull();
  });
});
