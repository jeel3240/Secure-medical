import { formatReceived, formatRelative } from '../lib/format';

/**
 * "Synced with EZ Texting · 1m ago" - when the worker last polled for new
 * leads. Sits under the Live label on Admin > Leads.
 *
 * It replaces a full-width yellow "No new leads pulled since ... - check the
 * worker" box. Jeel, 2026-09-28: it looked generated, and it dominated a page
 * whose job is the table. A line in the corner says the same thing and turns
 * amber only when it matters.
 *
 * `at` is `settings.updated_at` for the poll checkpoint, written on every
 * successful poll - POLLER.md, step 7. Until the same day it moved only when a
 * new contact arrived, so on a quiet account this said "check the worker"
 * about a worker that was polling every minute.
 *
 * Stale is three poll intervals without a poll, the spec's threshold.
 */
export function SyncStatus({ at, intervalSeconds }: { at: string | null; intervalSeconds: number }) {
  const stale = !at || Date.now() - new Date(at).getTime() > intervalSeconds * 3000;

  return (
    <span
      className={`sync${stale ? ' sync--stale' : ''}`}
      title={at ? `Last poll ${formatReceived(at)}` : 'The worker has never polled'}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8" />
        <path d="M21 3v5h-5M3 21v-5h5" />
      </svg>
      {!at
        ? 'Not synced with EZ Texting yet - check the worker'
        : stale
          ? `Last synced with EZ Texting ${formatRelative(at)} - check the worker`
          : `Synced with EZ Texting ${formatRelative(at)}`}
    </span>
  );
}
