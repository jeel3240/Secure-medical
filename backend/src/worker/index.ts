import '../config';
import { pool } from '../db/pool';
import { pollOnce } from './poller';

const DEFAULT_POLL_INTERVAL_SECONDS = 60;

// Re-read each tick so an admin changing the setting takes effect without a
// worker restart.
async function pollIntervalMs(): Promise<number> {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [
    'poll_interval_seconds',
  ]);
  const seconds = rows.length > 0 ? Number(rows[0].value) : DEFAULT_POLL_INTERVAL_SECONDS;
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_POLL_INTERVAL_SECONDS) * 1000;
}

// Serialised on purpose: one poller instance, one cycle at a time, so the
// checkpoint can't be advanced by two overlapping runs.
async function loop(): Promise<void> {
  for (;;) {
    try {
      const stats = await pollOnce();
      console.log(
        `poll tick fetched=${stats.fetched} inserted=${stats.inserted} ` +
          `skipped=${stats.skipped} suppressed=${stats.suppressed} ` +
          `openers=${stats.openersSent} ms=${stats.durationMs}`
      );
    } catch (err) {
      // Checkpoint is left where it was, so the next tick retries this ground.
      console.error('poll tick failed:', err instanceof Error ? err.message : err);
    }

    let waitMs = DEFAULT_POLL_INTERVAL_SECONDS * 1000;
    try {
      waitMs = await pollIntervalMs();
    } catch {
      // Fall back to the default rather than spinning if the DB is unreachable.
    }

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

console.log('worker started');
loop();
