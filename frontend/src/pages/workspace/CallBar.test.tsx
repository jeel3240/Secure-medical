/**
 * The call bar - Jeel's design, 2026-10-01. What it shows in each state of a
 * call, and the note box it becomes when the call ends.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadDetail } from '../../api/workspace';
import type { CallState } from '../../lib/call-state';
import { CallBar } from './CallBar';
import type { LeadCall } from './useLeadCall';

const addNote = vi.fn();
vi.mock('../../api/workspace', () => ({ addNote: (...args: unknown[]) => addNote(...args) }));

const LEAD = { id: 7, firstName: 'Priya', lastName: 'Sharma', phone: '+15550100016' } as LeadDetail;
const NOW = new Date('2026-10-01T15:00:42Z');
const SINCE = NOW.getTime() - 42_000;

function show(state: CallState) {
  const call: LeadCall = {
    state,
    start: vi.fn(),
    hangUp: vi.fn(),
    setMuted: vi.fn(),
    sendDigits: vi.fn(),
    dismiss: vi.fn(),
  };
  const onNoteSaved = vi.fn();
  const view = render(<CallBar lead={LEAD} call={call} now={NOW} onNoteSaved={onNoteSaved} />);
  return { call, onNoteSaved, ...view };
}

// Braces matter: a function returned from beforeEach is run by Vitest as a
// teardown, and returning the mock would call it again after every test.
beforeEach(() => {
  addNote.mockReset().mockResolvedValue({});
});

describe('while a call is being placed or is live', () => {
  it('is not there at all when there is no call', () => {
    const { container } = show({ phase: 'idle' });
    expect(container.firstChild).toBeNull();
  });

  it('says who is being called, and that it is ringing', () => {
    show({ phase: 'ringing' });
    expect(screen.getByText('Priya S.')).toBeDefined();
    expect(screen.getByText('(555) 010-0016')).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('Ringing…');
    expect(screen.getByRole('timer').textContent).toBe('0:00');
  });

  it('cannot mute or dial tones before the lead answers, but can always end', () => {
    const { call } = show({ phase: 'connecting' });
    expect((screen.getByRole('button', { name: 'Mute' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Keypad' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(call.hangUp).toHaveBeenCalled();
  });

  it('runs a clock once connected, and mutes', () => {
    const { call } = show({ phase: 'live', since: SINCE, muted: false });
    expect(screen.getByRole('status').textContent).toBe('Connected');
    expect(screen.getByRole('timer').textContent).toBe('0:42');
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(call.setMuted).toHaveBeenCalledWith(true);
  });

  it('says it is muted, and offers Unmute', () => {
    const { call } = show({ phase: 'live', since: SINCE, muted: true });
    expect(screen.getByRole('status').textContent).toBe('Connected · muted');
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(call.setMuted).toHaveBeenCalledWith(false);
  });

  it('opens a keypad that sends each tone and shows what was pressed', () => {
    const { call } = show({ phase: 'live', since: SINCE, muted: false });
    expect(screen.queryByRole('group', { name: 'Keypad' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keypad' }));
    for (const key of ['1', '0', '#']) fireEvent.click(screen.getByRole('button', { name: key }));
    expect((call.sendDigits as ReturnType<typeof vi.fn>).mock.calls.map(([d]) => d)).toEqual(['1', '0', '#']);
    expect(screen.getByRole('group', { name: 'Keypad' }).textContent).toContain('10#');
  });

  it('has no Hold: it is not built, and a fake one would mislead', () => {
    show({ phase: 'live', since: SINCE, muted: false });
    expect(screen.queryByRole('button', { name: /hold/i })).toBeNull();
  });
});

describe('once the call is over', () => {
  it('becomes a note box, saying how the call went', () => {
    show({ phase: 'ended', result: 'talked', seconds: 134 });
    expect(screen.getByRole('status').textContent).toBe('Call ended · 2:14');
    expect(screen.getByRole('textbox', { name: 'Note about this call' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
  });

  it('saves the note against the lead, reloads the page, and goes away', async () => {
    const { call, onNoteSaved } = show({ phase: 'ended', result: 'no_answer' });
    expect((screen.getByRole('button', { name: 'Save note' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Left a voicemail.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(call.dismiss).toHaveBeenCalled());
    expect(addNote).toHaveBeenCalledWith(7, 'Left a voicemail.');
    expect(onNoteSaved).toHaveBeenCalled();
  });

  it('Skip goes away without saving anything', () => {
    const { call } = show({ phase: 'ended', result: 'canceled' });
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(call.dismiss).toHaveBeenCalled();
    expect(addNote).not.toHaveBeenCalled();
  });

  it('keeps the note and says why if it could not be saved', async () => {
    // Shaped like the error axios throws for a 409 from the API.
    addNote.mockImplementation(async () => {
      throw Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 409, data: { error: 'not_picked', message: 'Pick this lead before acting on it.' } },
      });
    });
    const { call } = show({ phase: 'ended', result: 'talked', seconds: 10 });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Call back Friday.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Pick this lead before acting on it.'));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Call back Friday.');
    expect(call.dismiss).not.toHaveBeenCalled();
  });
});

describe('a call that could not be placed', () => {
  it('says why in a sentence, and can be dismissed', () => {
    const { call } = show({ phase: 'failed', message: 'Allow microphone access for this site in your browser, then call again.' });
    expect(screen.getByRole('status').textContent).toMatch(/Allow microphone access/);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(call.dismiss).toHaveBeenCalled();
  });
});
