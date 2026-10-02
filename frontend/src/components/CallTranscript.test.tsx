import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CallTranscript } from './CallTranscript';

const lines = [
  { speaker: 'agent', text: 'Hi Priya, it is Maya from Secure Medical.', startSec: 0.8 },
  { speaker: 'lead', text: 'Yes, I filled in the form.', startSec: 3.5 },
];

describe('a call\'s transcript', () => {
  it('is closed until asked for, then reads who said what, in order', () => {
    render(<CallTranscript detail={{ transcript: { status: 'completed', lines } }} agentName="Maya" leadName="Priya" />);
    const summary = screen.getByText('Transcript');
    fireEvent.click(summary);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['MayaHi Priya, it is Maya from Secure Medical.', 'PriyaYes, I filled in the form.']);
  });

  it('joins one speaker\'s run of sentences into one line', () => {
    const split = [
      { speaker: 'lead', text: 'Can you please tell me', startSec: 1 },
      { speaker: 'lead', text: 'what you provide?', startSec: 2 },
      { speaker: 'agent', text: 'Sure.', startSec: 3 },
    ];
    render(<CallTranscript detail={{ transcript: { status: 'completed', lines: split } }} />);
    fireEvent.click(screen.getByText('Transcript'));
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'LeadCan you please tell me what you provide?',
      'AgentSure.',
    ]);
  });

  it('says Agent and Lead when it does not know the names', () => {
    render(<CallTranscript detail={{ transcript: { status: 'completed', lines } }} />);
    expect(screen.getByText('Agent')).toBeDefined();
    expect(screen.getByText('Lead')).toBeDefined();
  });

  it.each([
    ['pending', 'Transcript in progress'],
    ['queued', 'Transcript in progress'],
    ['failed', 'Transcript not available'],
  ])('%s: one quiet line', (status, words) => {
    render(<CallTranscript detail={{ transcript: { status, lines: [] } }} />);
    expect(screen.getByText(words)).toBeDefined();
  });

  it('nothing at all for a call that was not recorded', () => {
    const { container } = render(<CallTranscript detail={{ outcome: 'answered' }} />);
    expect(container.firstChild).toBeNull();
  });
});
