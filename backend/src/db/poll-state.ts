/**
 * When the poller last read EZ Texting - B06; docs/POLLER.md, "A cycle".
 *
 * Two `settings` rows the poller writes at the end of every poll that read EZ
 * Texting, failed contacts or not:
 *
 * - `ezt_poll_checkpoint` - the newest contact's `createdAt` it has taken in,
 *   which is where the next poll reads back to. It is held back behind a
 *   contact that failed, and stands still on a quiet account.
 * - `ezt_last_read_at` - when it read EZ Texting. What the health check and
 *   Admin > Leads' "Synced" call the last poll (`LAST_READ_AT_SQL`).
 *
 * The two read the checkpoint row's `updated_at` before B06. That told a
 * poll that read the account but kept its checkpoint back from a stopped
 * worker only by accident, and the checkpoint itself goes in B25.
 */
import { pool } from './pool';

export const EZT_CHECKPOINT_KEY = 'ezt_poll_checkpoint';
export const EZT_LAST_READ_KEY = 'ezt_last_read_at';

/**
 * When EZ Texting was last read: the `ezt_last_read_at` row, else - on a
 * database whose worker has not polled since B06 - the checkpoint row's
 * `updated_at`, which every poll wrote before. Null when neither exists.
 */
export const LAST_READ_AT_SQL = `COALESCE(
  (SELECT updated_at FROM settings WHERE key = '${EZT_LAST_READ_KEY}'),
  (SELECT updated_at FROM settings WHERE key = '${EZT_CHECKPOINT_KEY}')
)`;

/** Records that a poll read EZ Texting, now. */
export async function markEztRead(): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [EZT_LAST_READ_KEY, new Date().toISOString()]
  );
}
