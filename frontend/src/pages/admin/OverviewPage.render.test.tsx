/** Admin > Overview on screen - the Sold total and the agents' Sold column (B05). */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Health, Overview } from '../../api/admin';

const OVERVIEW: Overview = {
  period: 'today',
  since: '2026-11-28T07:00:00.000Z',
  kpis: { leadsReceived: 40, responded: 22, completed: 15, closed: 9, sold: 4 },
  agents: [
    { agentId: 1, name: 'Nora', callbacksDue: 0, holding: 1, closed: 6, sold: 3, lastActiveAt: null },
    { agentId: 2, name: 'Sam', callbacksDue: 2, holding: 0, closed: 3, sold: 0, lastActiveAt: null },
  ],
  activity: [],
};
const HEALTH: Health = { status: 'ok', checkedAt: '2026-11-28T15:00:00.000Z', checks: [] };

vi.mock('../../api/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/admin')>()),
  getOverview: async () => OVERVIEW,
  getHealth: async () => HEALTH,
}));

const { OverviewPage } = await import('./OverviewPage');

describe('Overview - sold', () => {
  it('a Sold total after Closed', async () => {
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    const label = await screen.findByText('Sold', { selector: '.stats__label' });
    const item = label.closest('.stats__item') as HTMLElement;
    expect(within(item).getByText('4')).toBeDefined();
    expect(within(item).getByText('Closed as sold')).toBeDefined();
    expect(item.previousElementSibling?.querySelector('.stats__label')?.textContent).toBe('Closed');
  });

  it('and a Sold column for each agent, after Closed - "-" for none', async () => {
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    await screen.findByText('Nora');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers.slice(headers.indexOf('Closed'), headers.indexOf('Closed') + 2)).toEqual(['Closed', 'Sold']);
    const cells = (name: string) => within(screen.getByText(name).closest('tr') as HTMLElement).getAllByRole('cell').map((c) => c.textContent);
    expect(cells('Nora').slice(2, 4)).toEqual(['6', '3']);
    expect(cells('Sam').slice(2, 4)).toEqual(['3', '-']);
  });
});
