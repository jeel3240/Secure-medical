/**
 * Writing the activity log - docs/AUDIT.md.
 *
 * `recordActivity` takes the connection it should write on, so a caller inside
 * a transaction passes its client and the record commits with the action - or
 * not at all. A record written separately could say something happened that
 * was rolled back, or miss something that was not.
 *
 * Imports nothing that loads the pool or config, so it is safe to import at
 * module scope anywhere, the way db/dnc.ts is.
 */

import type { ActivityEntry } from '../core/activity';

/** A pool or a transaction's client: anything that runs a query. */
export interface ActivityWriter {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}

export async function recordActivity(q: ActivityWriter, entry: ActivityEntry): Promise<void> {
  await q.query(
    `INSERT INTO activity_log (actor_id, action, lead_id, subject_user_id, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.leadId ?? null,
      entry.subjectUserId ?? null,
      JSON.stringify(entry.detail ?? {}),
    ]
  );
}

/**
 * The same insert as a SQL fragment, for a statement that must stay a single
 * statement - claiming a lead is one UPDATE precisely so two agents cannot both
 * win, and its record has to ride in that statement rather than follow it.
 *
 *   WITH done AS (UPDATE ... RETURNING ...),
 *        logged AS (${activityInsertSql} SELECT $2, 'lead.picked_up', $1, NULL, jsonb_build_object(...) FROM done)
 */
export const activityInsertSql = `INSERT INTO activity_log (actor_id, action, lead_id, subject_user_id, detail)`;

/** Keeps the raw request a webhook received, before anything is decided about it. */
export async function archiveWebhook(
  q: ActivityWriter,
  event: { source: 'eztexting' | 'twilio'; path: string; payload: unknown }
): Promise<void> {
  await q.query(`INSERT INTO webhook_events (source, path, payload) VALUES ($1, $2, $3::json)`, [
    event.source,
    event.path,
    JSON.stringify(event.payload ?? {}),
  ]);
}
