/**
 * What the lead said to Seri, under the robot's call - A19. Her lines and the
 * lead's in order, then how her part ended.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatDay, formatTime } from '../lib/format';
import { SeriConversation, seriEndedText } from './SeriConversation';

const turns = [
  { who: 'seri', text: 'Hi, is this John?' },
  { who: 'lead', text: "Yes. I'm driving, call me Monday at 3." },
  { who: 'seri', text: 'Sure, someone will call you Monday at 3 PM your time.' },
];

describe('her conversation under the call', () => {
  it('a chat, Lead and Seri in order, then how her part ended - closed until opened', () => {
    const at = '2026-11-16T20:00:00.000Z';
    const { container } = render(
      <SeriConversation detail={{ seri: { turns, ended: { action: 'book_callback', at, timeZone: 'America/New_York', reason: 'Wants to order' } } }} />
    );
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(screen.getByText('Seri', { selector: 'summary' })).toBeDefined();
    const lines = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(lines).toEqual([
      'SeriHi, is this John?',
      "LeadYes. I'm driving, call me Monday at 3.",
      'SeriSure, someone will call you Monday at 3 PM your time.',
      `Booked a call back: ${formatDay(new Date(at))} ${formatTime(new Date(at))}`,
    ]);
    // The lead's name in the lead's colour, as in a transcript.
    expect(container.querySelectorAll('.transcript__line--lead')).toHaveLength(1);
  });

  it('a fallback: the action line says the script took the call', () => {
    render(<SeriConversation detail={{ seri: { turns: turns.slice(0, 2), ended: { action: 'fallback', why: 'model_slow' } } }} />);
    expect(screen.getByText('Seri stopped - the call went on with the script')).toBeDefined();
  });

  it('she ended with nothing - the lead hung up: the chat alone', () => {
    const { container } = render(<SeriConversation detail={{ seri: { turns: turns.slice(0, 2), ended: null } }} />);
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('nothing for a call she did not take, or with nothing said and nothing ended', () => {
    expect(render(<SeriConversation detail={{ scriptResult: 'not_interested' }} />).container.innerHTML).toBe('');
    expect(render(<SeriConversation detail={{ seri: { turns: [], ended: null } }} />).container.innerHTML).toBe('');
  });
});

describe('how her part ended, in words', () => {
  it.each([
    [{ action: 'transfer_to_agent' }, 'Put through to a person'],
    [{ action: 'send_link' }, 'Texted the link'],
    [{ action: 'opt_out' }, 'Asked not to be called - number blocked'],
    [{ action: 'end_call', reason: 'not_interested' }, 'Ended - not interested'],
    [{ action: 'end_call', reason: 'wrong_person' }, 'Ended - wrong person'],
    [{ action: 'end_call', reason: 'emergency' }, 'Ended - told to call 911'],
    [{ action: 'end_call', reason: 'no_response' }, 'Ended - no response'],
    [{ action: 'end_call', reason: 'time_limit' }, 'Ended - three minutes up'],
    [{ action: 'end_call', reason: 'other' }, 'Ended'],
    [{ action: 'fallback', why: 'twilio_failed' }, 'Seri stopped - the call went on with the script'],
  ])('%j reads "%s"', (ended, words) => {
    expect(seriEndedText(ended)).toBe(words);
  });

  it('none, or one it does not know: nothing', () => {
    expect(seriEndedText(null)).toBeNull();
    expect(seriEndedText({ action: 'something_new' })).toBeNull();
  });
});
