/**
 * Wrap up's outcome - B04: Closed asks why, and Save sends it. The route and
 * the row are proved on the server (`api/__tests__/dispositions.test.ts`,
 * `scripts/dispositions-live-check.ts`); this is the popup in front of them.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadDetail } from '../../api/workspace';
import { ActionsPanel } from './ActionsPanel';

const setDisposition = vi.fn();
vi.mock('../../api/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/workspace')>()),
  setDisposition: (...args: unknown[]) => setDisposition(...args),
  addNote: vi.fn(),
  createCallback: vi.fn(),
}));

// What the panel reads of a lead: the rest of the card is the page's.
const lead = (closed: LeadDetail['closed'] = null) =>
  ({ id: 7, firstName: 'Omar', phone: '+15555550142', closed }) as unknown as LeadDetail;

function show(closed: LeadDetail['closed'] = null) {
  render(
    <MemoryRouter>
      <ActionsPanel lead={lead(closed)} refresh={async () => undefined} canAct />
    </MemoryRouter>
  );
}

const closedButton = () => screen.getByRole('radio', { name: /^Closed/ });
const asking = () => screen.queryByRole('dialog', { name: 'Why is this lead closed?' });

// Braces: a function returned from beforeEach runs as a teardown.
beforeEach(() => {
  setDisposition.mockReset().mockResolvedValue({});
});

describe('Closed asks why', () => {
  it('pressing Closed opens the question, and chooses nothing yet', () => {
    show();
    fireEvent.click(closedButton());

    expect(asking()).not.toBeNull();
    expect(['Sold', 'Not interested', 'Wrong number'].map((name) => screen.getByRole('button', { name }) !== null)).toEqual([true, true, true]);
    expect(closedButton().getAttribute('aria-checked')).toBe('false');
  });

  it('Sold chooses Closed with it - "Closed · Sold" - and Save sends both', async () => {
    show();
    fireEvent.click(closedButton());
    fireEvent.click(screen.getByRole('button', { name: 'Sold' }));

    expect(asking()).toBeNull();
    expect(closedButton().textContent).toBe('Closed · Sold');
    expect(closedButton().getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setDisposition).toHaveBeenCalledWith(7, 'closed', { confirmDnc: false, reason: 'sold' }));
  });

  it('Cancel chooses nothing: no outcome, nothing to save', () => {
    show();
    fireEvent.click(closedButton());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(asking()).toBeNull();
    expect(closedButton().getAttribute('aria-checked')).toBe('false');
    expect(closedButton().textContent).toBe('Closed');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('pressing Closed again, once chosen, takes it back without asking', () => {
    show();
    fireEvent.click(closedButton());
    fireEvent.click(screen.getByRole('button', { name: 'Wrong number' }));
    fireEvent.click(closedButton());

    expect(asking()).toBeNull();
    expect(closedButton().getAttribute('aria-checked')).toBe('false');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a lead already closed shows why it was', () => {
    show({ by: 'Nora', at: '2026-11-28T15:00:00.000Z', reason: 'not_interested' });
    expect(closedButton().textContent).toBe('Closed · Not interested');
    expect(closedButton().getAttribute('aria-checked')).toBe('true');
  });

  it('and Closed alone, closed before that was asked', () => {
    show({ by: 'Nora', at: '2026-11-28T15:00:00.000Z', reason: null });
    expect(closedButton().textContent).toBe('Closed');
  });

  it('DNC still asks its own question, and sends no reason', async () => {
    show();
    fireEvent.click(screen.getByRole('radio', { name: 'DNC' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, block this number' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(setDisposition).toHaveBeenCalledWith(7, 'dnc', { confirmDnc: true, reason: undefined }));
  });
});
