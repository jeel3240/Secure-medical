/** Admin > Overview's recent activity, in words - B04 adds why a lead was closed. */
import { describe, expect, it } from 'vitest';
import type { Overview } from '../../api/admin';
import { activityAfter, activityText } from './OverviewPage';

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
