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
import { ALONE, NO_CALL, type RingKind } from '../lib/incoming-state';
import { isBrowserBusy, setBusy } from '../lib/presence';
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
  conversation: { status: 'expired', step: 20, question: 'Q2', score: 45, tier: 'WARM', agentTookOverAt: null, flow: 'antibiotics', endOutcome: null },
  chips: [
    { question: 10, key: 'q1', heading: 'Requested info', answer: 'Yes', choice: '1' },
    { question: 20, key: 'q2', heading: 'Used telemedicine', answer: 'No', choice: '2' },
  ],
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

function aRing(lead = { id: 7, name: 'Priya Sharma', phone: '+15550100016' }, kind: RingKind = ALONE) {
  let handlers: CallHandlers | null = null;
  const handle = { hangUp: vi.fn(), setMuted: vi.fn(), sendDigits: vi.fn() };
  const ring: IncomingRing = {
    lead,
    kind,
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

  it('then what we know about them: tier, score, their last answer, where the questions stopped, and our tries today', async () => {
    await show();
    act(() => twilio!.onRing(aRing().ring));
    await waitFor(() => expect(screen.getByText('45')).toBeDefined());
    expect(screen.getByText('/ 100')).toBeDefined();
    expect(screen.getByText('WARM')).toBeDefined();
    // The last thing they answered, under that question's own heading - not the first.
    expect(screen.getByText('Used telemedicine')).toBeDefined();
    expect(screen.getByText('No')).toBeDefined();
    expect(screen.queryByText('Requested info')).toBeNull();
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

describe('a ring that went to several people (T11)', () => {
  const PRIYA = { id: 7, name: 'Priya Sharma', phone: '+15550100016' };
  const GROUP: RingKind = { group: true, transfer: null };
  const TRANSFER: RingKind = { group: true, transfer: { step: 'Offer' } };

  /** Answers a ring to this person alone and ends it, leaving the note box open with something typed. */
  async function noteOpen() {
    const { ring, events } = aRing();
    act(() => twilio!.onRing(ring));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    act(() => events().onAnswered());
    act(() => events().onEnded());
    fireEvent.change(screen.getByLabelText('Note about this call'), { target: { value: 'Wants the 25% off' } });
  }

  it('someone else took it: the card clears quietly - no "Missed call"', async () => {
    await show();
    const { ring } = aRing(PRIYA, GROUP);
    act(() => twilio!.onRing(ring));
    expect(screen.getByText('Incoming call')).toBeDefined();
    act(() => twilio!.onRingOver(ring));
    expect(screen.queryByText(/Incoming call|Missed call/)).toBeNull();
    expect(stopRinging).toHaveBeenCalled();
  });

  it('arriving while the note box after a call is open: declined here, and the note kept as typed', async () => {
    await show();
    await noteOpen();
    const { ring } = aRing({ id: 8, name: 'Sam Lee', phone: '+15550100017' }, GROUP);
    act(() => twilio!.onRing(ring));

    expect(ring.decline).toHaveBeenCalled();
    expect(screen.queryByText('Incoming call')).toBeNull();
    expect((screen.getByLabelText('Note about this call') as HTMLTextAreaElement).value).toBe('Wants the 25% off');
  });

  it('arriving while a call from a lead’s page, or its note, is open: declined here, nothing shown', async () => {
    await show();
    setBusy('lead-call', true);
    try {
      const { ring } = aRing(PRIYA, GROUP);
      act(() => twilio!.onRing(ring));
      expect(ring.decline).toHaveBeenCalled();
      expect(screen.queryByText('Incoming call')).toBeNull();
    } finally {
      setBusy('lead-call', false);
    }
  });

  it('a ring to this person alone still takes the note box’s place, as it always has - it is their lead calling', async () => {
    await show();
    await noteOpen();
    const { ring } = aRing({ id: 8, name: 'Sam Lee', phone: '+15550100017' });
    act(() => twilio!.onRing(ring));
    expect(ring.decline).not.toHaveBeenCalled();
    expect(screen.getByText('Incoming call')).toBeDefined();
  });

  it('a transfer says so in place of "Calling back"', async () => {
    await show();
    act(() => twilio!.onRing(aRing(PRIYA, TRANSFER).ring));
    expect(screen.getByText('Transfer · said yes to the offer')).toBeDefined();
    // Once what we know about them has loaded - the timeline holds two of our calls.
    await waitFor(() => expect(screen.getByText('45')).toBeDefined());
    await act(async () => undefined);
    expect(screen.queryByText(/Calling back/)).toBeNull();
    expect(screen.getByText('Accepting opens Priya’s workspace and assigns the lead to you.')).toBeDefined();
  });
});

describe('keeping the browser busy, so no transfer rings it meanwhile (T9)', () => {
  it('from the first ring until the note box after the call is done', async () => {
    await show();
    expect(isBrowserBusy()).toBe(false);
    const { ring, events } = aRing();
    act(() => twilio!.onRing(ring));
    expect(isBrowserBusy()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    act(() => events().onAnswered());
    act(() => events().onEnded());
    // The call is over, but the note box is still open.
    expect(isBrowserBusy()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(isBrowserBusy()).toBe(false);
  });

  it('not once a ring is missed - the notice does not keep anyone busy', async () => {
    await show();
    const { ring } = aRing();
    act(() => twilio!.onRing(ring));
    act(() => twilio!.onRingOver(ring));
    expect(screen.getByText('Missed call · Priya S.')).toBeDefined();
    expect(isBrowserBusy()).toBe(false);
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
