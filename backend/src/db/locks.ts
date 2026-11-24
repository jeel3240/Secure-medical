/**
 * Postgres advisory locks for work that must run in one place at a time -
 * the dialler's look (T20) and, since 2026-11-22, the worker's whole cycle
 * (review M14): two workers on one database each polled, retried the same
 * first question and sent it twice.
 */

import { pool } from './pool';

/**
 * Runs `work` holding the lock `name`, or not at all - null - when another
 * session holds it. The lock is the session's: a worker that dies lets it go
 * with its connection.
 */
export async function withTryLock<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  let locked: boolean;
  try {
    locked = (await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [name])).rows[0].locked;
  } catch (err) {
    client.release(err as Error);
    throw err;
  }
  if (!locked) {
    client.release();
    return null;
  }
  try {
    return await work();
  } finally {
    // A connection whose lock could not be let go is thrown away, never handed
    // back to the pool still holding it - every later look would find it
    // held; and the work's own error, if any, is the one that is thrown.
    let stuck: Error | undefined;
    try {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [name]);
    } catch (err) {
      stuck = err as Error;
    }
    client.release(stuck);
  }
}
