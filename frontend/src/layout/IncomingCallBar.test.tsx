/**
 * The incoming-call bar: what the agent sees when a lead rings, and when
 * nobody picked up - TWILIO.md, "Incoming calls".
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallHandlers, IncomingHandlers, IncomingRing } from '../lib/calling';
import { useIncomingCall } from '../lib/incoming-call';
import { NO_CALL } from '../lib/incoming-state';
import { IncomingCallBar } from './IncomingCallBar';

const getCallConfig = vi.fn();
const claimLead = vi.fn();
const stop = vi.fn();
let twilio: IncomingHandlers | null = null;

vi.mock('../api/calls', () => ({ getCallConfig: () => getCallConfig() }));
vi.mock('../api/leads', () => ({ claimLead: (id: number) => claimLead(id) }));
vi.mock('../api/workspace', () => ({ addNote: vi.fn() }));
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

async function show() {
  const view = render(
    <MemoryRouter initialEntries={['/queue']}>
      <Routes>
        <Route path="/queue" element={<p>the queue</p>} />
        <Route path="/leads/:id" element={<p>the lead’s page</p>} />
      </Routes>
      <IncomingCallBar />
    </MemoryRouter>
  );
  await waitFor(() => expect(twilio).not.toBeNull());
  return view;
}

beforeEach(() => {
  twilio = null;
  stop.mockReset();
  claimLead.mockReset().mockResolvedValue(undefined);
  getCallConfig.mockReset().mockResolvedValue({ enabled: true, callerId: '+14804708259' });
  useIncomingCall.setState({ state: NO_CALL });
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
        <IncomingCallBar />
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
  it('says who is calling, with Answer and Decline', async () => {
    await show();
    act(() => twilio!.onRing(aRing().ring));
    expect(screen.getByText('Priya Sharma')).toBeDefined();
    expect(screen.getByText('(555) 010-0016')).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('Incoming call');
    expect(screen.getByRole('button', { name: 'Answer' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDefined();
  });

  it('a lead with no name is shown by number', async () => {
    await show();
    act(() => twilio!.onRing(aRing({ id: 7, name: '', phone: '+15550100016' }).ring));
    expect(screen.getByText('(555) 010-0016')).toBeDefined();
  });

  it('Answer: picks up, takes the lead, opens its page, and shows the live call', async () => {
    await show();
    const { ring, events, handle } = aRing();
    act(() => twilio!.onRing(ring));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));

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
    expect(screen.queryByText(/call/i)).toBeNull();
  });
});

describe('nobody picked up', () => {
  it('says the call was missed, and stays until dismissed', async () => {
    await show();
    const { ring } = aRing();
    act(() => twilio!.onRing(ring));
    act(() => twilio!.onRingOver(ring));

    expect(screen.getByRole('status').textContent).toBe('Missed call · they were told we will call back');
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Missed call/)).toBeNull();
  });

  it('Open lead goes to the lead, to call them back', async () => {
    await show();
    const { ring } = aRing();
    act(() => twilio!.onRing(ring));
    act(() => twilio!.onRingOver(ring));
    fireEvent.click(screen.getByRole('button', { name: 'Open lead' }));
    expect(screen.getByText('the lead’s page')).toBeDefined();
    expect(screen.queryByText(/Missed call/)).toBeNull();
  });
});
