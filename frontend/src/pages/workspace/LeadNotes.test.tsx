import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TimelineEntry } from '../../api/workspace';
import { LeadNotes, notesNewestFirst } from './LeadNotes';

const note = (minutesAgo: number, body: string, author = 'Maya Chen'): TimelineEntry => ({
  kind: 'note',
  at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  author,
  detail: { body },
});
const sms: TimelineEntry = { kind: 'sms', at: new Date().toISOString(), author: null, detail: { body: 'Question 1' } };

describe('the workspace notes card', () => {
  it('keeps only notes, newest first', () => {
    expect(notesNewestFirst([note(30, 'older'), sms, note(5, 'newest')]).map((n) => n.body)).toEqual(['newest', 'older']);
  });

  it('shows the three newest, and the rest on request', () => {
    const entries = Array.from({ length: 5 }, (_, i) => note(i * 10, `note ${i}`));
    const { container, getByRole } = render(<LeadNotes entries={entries} />);
    const bodies = () => [...container.querySelectorAll('.notes-card__body')].map((p) => p.textContent);
    expect(bodies()).toEqual(['note 0', 'note 1', 'note 2']);
    fireEvent.click(getByRole('button', { name: 'Show all 5' }));
    expect(bodies()).toHaveLength(5);
    fireEvent.click(getByRole('button', { name: 'Show fewer' }));
    expect(bodies()).toHaveLength(3);
  });

  it('says who wrote each one', () => {
    const { container } = render(<LeadNotes entries={[note(1, 'Booked Thursday', 'Jeel Kakadiya')]} />);
    expect(container.querySelector('.notes-card__meta')?.textContent).toMatch(/^Jeel Kakadiya · Today, /);
    expect(container.querySelector('.notes-card__more')).toBeNull();
  });

  it('says where to add one when there are none', () => {
    const { container } = render(<LeadNotes entries={[sms]} />);
    expect(container.textContent).toContain('No notes yet. Add one in Wrap up.');
  });
});
