/** Admin > Overview: the recent activity in words - B04 adds why a lead was closed - and the totals, Sold among them (B05). */
import { describe, expect, it } from 'vitest';
import type { Overview } from '../../api/admin';
import { activityAfter, activityText, overviewStats } from './OverviewPage';

const entry = (kind: Overview['activity'][number]['kind'], detail: Record<string, unknown>): Overview['activity'][number] => ({
  kind,
  at: '2026-11-28T15:00:00.000Z',
  agentName: 'Nora',
  leadId: 7,
  leadName: 'Omar Haddad',
  detail,
});

describe('a lead closed, on the feed', () => {
  it('"Nora closed Omar Haddad · Sold"', () => {
    const closed = entry('disposition', { value: 'closed', reason: 'sold' });
    expect([activityText(closed), activityAfter(closed)]).toEqual(['closed', ' · Sold']);
  });

  it('nothing after the name for one closed before the reason was asked', () => {
    const closed = entry('disposition', { value: 'closed', reason: null });
    expect([activityText(closed), activityAfter(closed)]).toEqual(['closed', '']);
  });

  it('nothing after the name for anything else', () => {
    expect(activityAfter(entry('disposition', { value: 'dnc', reason: null }))).toBe('');
    expect(activityAfter(entry('note', { body: 'sold' }))).toBe('');
  });
});

describe('the totals - B05', () => {
  const kpis = { leadsReceived: 40, responded: 22, completed: 15, closed: 9, sold: 4 };

  it('Sold comes after Closed, the last of the five', () => {
    expect(overviewStats(kpis).map((s) => s.label)).toEqual(['Leads in', 'Replied', 'Completed', 'Closed', 'Sold']);
  });

  it('with its own number and line', () => {
    const stats = overviewStats(kpis);
    expect(stats[stats.length - 1]).toEqual({ label: 'Sold', value: 4, sub: 'Closed as sold' });
  });
});
