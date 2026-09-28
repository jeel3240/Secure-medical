/**
 * The EZ Texting sync line on Admin > Leads - Jeel, 2026-09-28, in place of a
 * yellow "check the worker" box. Quiet while the worker polls; amber after
 * three poll intervals without one.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SyncStatus } from './SyncStatus';

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

const renderSync = (at: string | null) => {
  const { container } = render(<SyncStatus at={at} intervalSeconds={60} />);
  const el = container.querySelector('.sync')!;
  return { text: el.textContent, stale: el.classList.contains('sync--stale') };
};

describe('the sync line', () => {
  it('is quiet while the worker polls', () => {
    expect(renderSync(ago(20))).toEqual({ text: 'Synced with EZ Texting just now', stale: false });
  });

  it('is still quiet at two intervals', () => {
    expect(renderSync(ago(120)).stale).toBe(false);
  });

  it('turns amber after three intervals, and says what to check', () => {
    expect(renderSync(ago(6 * 60))).toEqual({
      text: 'Last synced with EZ Texting 6m ago - check the worker',
      stale: true,
    });
  });

  it('says so when the worker has never polled', () => {
    expect(renderSync(null)).toEqual({ text: 'Not synced with EZ Texting yet - check the worker', stale: true });
  });
});
