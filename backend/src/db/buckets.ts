/**
 * Buckets in the database - docs/BUCKETS.md; the table is migration 026 (B07).
 *
 * A bucket is one campaign: its leads' EZ Texting group, its text questions, its
 * call script, what Seri knows for it. The app runs one, antibiotics. Every flow
 * and call script is in one, and a conversation is in its flow's.
 */
import type { Db } from './flows';

/**
 * There is more than one bucket, where the code can only take in leads for one:
 * the poller reads one EZ Texting group, and has no way to tell which bucket a
 * contact arrived for until each arrival has a bucket of its own (B23, B24). So it
 * stops rather than give a second bucket's leads antibiotics' questions.
 */
export class MoreThanOneBucket extends Error {
  constructor(readonly count: number) {
    super(`${count} buckets where only one is read yet - see docs/BUCKETS.md`);
    this.name = 'MoreThanOneBucket';
  }
}

/**
 * The id of the one bucket - what the poller gives each lead it takes in (B08).
 * Throws `MoreThanOneBucket` when there are more, and an error when there is
 * none: migration 026 makes antibiotics, so none is a database not migrated.
 */
export async function onlyBucket(q: Db): Promise<number> {
  const { rows } = await q.query(`SELECT id, count(*) OVER ()::int AS buckets FROM buckets ORDER BY id LIMIT 1`);
  if (rows.length === 0) throw new Error('No bucket: the database has not run migration 026 - see docs/BUCKETS.md');
  if (rows[0].buckets > 1) throw new MoreThanOneBucket(rows[0].buckets);
  return rows[0].id;
}

/** A bucket's id by its key - `antibiotics`. Null when there is no such bucket. */
export async function bucketByKey(q: Db, key: string): Promise<number | null> {
  const { rows } = await q.query(`SELECT id FROM buckets WHERE key = $1`, [key]);
  return rows[0]?.id ?? null;
}
