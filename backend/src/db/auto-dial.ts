/**
 * The robot placing its calls - T20, docs/AUTO-CALLS.md "When a lead is
 * called" and "Traffic": who is called next, how much room there is, and the
 * calls that never reached Twilio. The worker's job is `worker/auto-calls.ts`;
 * each call is placed by `worker/place-auto-call.ts`, as from T12.
 */

import type { DialRoom } from '../core/auto-dial';
import { activityInsertSql, recordActivity } from './activity';
import { ON_HOLD_SQL } from './auto-calls';
import { readHoldMaxSeconds } from './call-script';
import { WORKED_SQL } from './lead-state';
import { pool } from './pool';
import { FREE_SQL } from './presence';

/**
 * How long a call of the robot's counts as still going with nobody on it, for
 * the room - and how long a row that never reached Twilio is left before it is
 * closed. Ten minutes: far longer than any call that is ringing or asking.
 */
export const UNDER_WAY_MINUTES = 10;

/** Now, as `settings` keeps a time: ISO 8601, UTC. */
const NOW_TEXT = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * The worker starting says whether it places automated calls - T20 review.
 * Kept in `settings.auto_calls_on`. **Each switch-on starts afresh**: when the
 * worker starts with them on after they were off - or never on - when they
 * were switched on is now (`auto_calls_since`), so leads that arrived while
 * they were off are never called: "never the backlog", every time, not only
 * the first. A restart while on changes nothing. The switch-on is recorded -
 * `auto_calls.switched_on`, with the time it replaced - since it overwrites
 * the last one.
 */
export async function recordAutoCallsSwitch(on: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One writer at a time, row or no row.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('auto_calls_switch'))`);
    const { rows } = await client.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key IN ('auto_calls_on', 'auto_calls_since')`
    );
    const value = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
    if (on && value('auto_calls_on') !== 'true') {
      const { rows: written } = await client.query<{ value: string }>(
        `INSERT INTO settings (key, value) VALUES ('auto_calls_since', ${NOW_TEXT})
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
         RETURNING value`
      );
      await recordActivity(client, {
        action: 'auto_calls.switched_on',
        actorId: null,
        detail: { since: written[0].value, previousSince: value('auto_calls_since') },
      });
    }
    await client.query(
      `INSERT INTO settings (key, value) VALUES ('auto_calls_on', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [on ? 'true' : 'false']
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * When automated calls were last switched on - `settings.auto_calls_since`
 * (`recordAutoCallsSwitch`): only leads that arrived after it are called.
 * Written now if it is missing, so a worker that never recorded a switch still
 * calls no backlog. A value that is not a time is an error, never a guess -
 * every look fails, and says why, until it is put right.
 */
export async function autoCallsSince(): Promise<Date> {
  await pool.query(`INSERT INTO settings (key, value) VALUES ('auto_calls_since', ${NOW_TEXT}) ON CONFLICT (key) DO NOTHING`);
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'auto_calls_since'`);
  const since = new Date(rows[0].value);
  if (Number.isNaN(since.getTime())) throw new Error(`settings.auto_calls_since is not a time: ${rows[0].value}`);
  return since;
}

/**
 * How long after it was placed a call of the robot's must have been heard of -
 * an end or a verdict - before its silence means Twilio's reports are not
 * reaching us; and how long that silence stops the robot.
 */
export const SILENT_AFTER_MINUTES = 3;
export const SILENT_FOR_MINUTES = 60;

/**
 * Who can take a "yes" now, against the robot's calls still going -
 * `callsToPlace` - and what stops it altogether.
 *
 * - **On hold** counts only a hold younger than the safety stop and two
 *   minutes: no real hold lasts longer, so an older one is a call whose end
 *   never reached us, and must not stop the robot for good (the hold watcher
 *   also ends it from Twilio's record - `api/hold-watch.ts`).
 * - **Silent**: its calls placed between `SILENT_AFTER_MINUTES` and
 *   `SILENT_FOR_MINUTES` ago that have neither ended nor had Twilio's verdict on
 *   who answered - every call has one or the other within a minute and a half,
 *   ringing out included. Twilio's reports are not reaching us - `PUBLIC_URL`
 *   wrong, the api down, or it was switched off without the worker.
 * - **Scripted**: a call script is active.
 */
export async function dialRoom(): Promise<DialRoom> {
  const holdMaxSeconds = await readHoldMaxSeconds(pool);
  const { rows } = await pool.query<{ free: number; underway: number; on_hold: boolean; silent: number; scripted: boolean }>(
    `SELECT (SELECT count(*)::int FROM users u WHERE ${FREE_SQL}) AS free,
            (SELECT count(*)::int FROM calls c
             WHERE c.direction = 'automated' AND c.outcome IS NULL AND c.agent_id IS NULL
               AND c.started_at > now() - interval '${UNDER_WAY_MINUTES} minutes') AS underway,
            EXISTS (SELECT 1 FROM calls c WHERE ${ON_HOLD_SQL} AND c.held_at > now() - make_interval(secs => $1)) AS on_hold,
            (SELECT count(*)::int FROM calls c
             WHERE c.direction = 'automated' AND c.twilio_call_sid IS NOT NULL
               AND c.outcome IS NULL AND c.answered_by IS NULL
               AND c.started_at < now() - interval '${SILENT_AFTER_MINUTES} minutes'
               AND c.started_at > now() - interval '${SILENT_FOR_MINUTES} minutes') AS silent,
            EXISTS (SELECT 1 FROM call_scripts s WHERE s.is_active) AS scripted`,
    [holdMaxSeconds + 120]
  );
  const r = rows[0];
  return { free: r.free, underway: r.underway, onHold: r.on_hold, silent: r.silent, scripted: r.scripted };
}

/**
 * The leads to call now, oldest first - "When a lead is called". A lead is
 * called when:
 *
 * - it arrived after `since`, when automated calls were last switched on
 *   (`recordAutoCallsSwitch`);
 * - its first text went out at least `waitMinutes` ago (`question_sent_at` of
 *   its conversation), and that conversation is still open - not answered,
 *   expired or stopped;
 * - it has not replied - no text from it, and no call from it either: either
 *   is a lead reaching us, and a person's to deal with;
 * - nobody holds it, and nobody has worked it (`WORKED_SQL`: a note, a
 *   callback, an outcome - Closed among them - an agent's call or text);
 * - its number is not blocked, and the robot has never called it.
 *
 * Oldest first, by when the first text went out: a lead whose hour ended
 * outside the calling hours is called at their start, before newer ones.
 * `only`, outside production, is the test numbers - the only ones looked at,
 * so a laptop's fake leads are never even tried. `leadId` asks about that one
 * lead alone - again, just before its call (`stillDue`). `now` is a parameter
 * so the live check can stand at any time. Only leads from the last
 * `LOOK_BACK_DAYS` are looked at: a conversation ends long before that
 * (`expiry_days`, 7), so nothing due is missed, and the look stays small.
 */
export async function leadsToCall(opts: {
  now: Date;
  since: Date;
  waitMinutes: number;
  only: readonly string[] | null;
  limit: number;
  leadId?: number;
}): Promise<number[]> {
  if (opts.limit <= 0) return [];
  const { rows } = await pool.query<{ id: number }>(
    `SELECT l.id
     FROM leads l
     JOIN LATERAL (
       SELECT c.status, c.question_sent_at FROM conversations c
       WHERE c.lead_id = l.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1
     ) c ON true
     WHERE l.created_at > $2
       AND l.created_at > $1::timestamptz - interval '${LOOK_BACK_DAYS} days'
       AND ($6::int IS NULL OR l.id = $6)
       AND c.status = 'open'
       AND c.question_sent_at <= $1::timestamptz - ($3 || ' minutes')::interval
       AND l.assigned_to IS NULL
       AND NOT ${WORKED_SQL}
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.lead_id = l.id AND m.direction = 'inbound')
       AND NOT EXISTS (SELECT 1 FROM calls ic WHERE ic.lead_id = l.id AND ic.direction = 'inbound')
       AND NOT EXISTS (SELECT 1 FROM calls ac WHERE ac.lead_id = l.id AND ac.direction = 'automated')
       AND NOT EXISTS (SELECT 1 FROM dnc_list d WHERE d.phone = l.phone AND d.released_at IS NULL)
       AND ($4::text[] IS NULL OR l.phone = ANY($4::text[]))
     ORDER BY c.question_sent_at, l.id
     LIMIT $5`,
    [opts.now, opts.since, String(opts.waitMinutes), opts.only, opts.limit, opts.leadId ?? null]
  );
  return rows.map((r) => r.id);
}

/** How far back `leadsToCall` looks - far longer than a conversation stays open. */
export const LOOK_BACK_DAYS = 30;

/**
 * Whether the lead `leadId` is still due, asked just before its call (T20
 * review): the calls of one look go out one after another, each waiting on
 * Twilio, and meanwhile a lead may reply, ring us, be picked up or worked.
 * The same rules as `leadsToCall`, for that lead alone.
 */
export async function stillDue(opts: {
  leadId: number;
  now: Date;
  since: Date;
  waitMinutes: number;
  only: readonly string[] | null;
}): Promise<boolean> {
  return (await leadsToCall({ ...opts, limit: 1 })).length === 1;
}

/**
 * Closes the robot's calls whose placing Twilio never confirmed - T12 left the
 * row when Twilio's answer did not come, in case the call went out anyway -
 * once no webhook has named it in `UNDER_WAY_MINUTES`. Most likely it never
 * went out; if it did, our webhooks were not being heard either, so its
 * record says only that: `no_webhook`. Ended as `failed`, `unanswered`, with
 * its `call.ended` record, so it is not "under way" for ever; and a webhook
 * that names it after this is not taken for it (`linkAutomatedCall`). Returns
 * how many.
 */
export async function closeUnplacedCalls(): Promise<number> {
  const { rowCount } = await pool.query(
    `WITH closed AS (
       UPDATE calls SET outcome = 'failed', duration_sec = 0, ended_at = now(), script_result = 'unanswered'
       WHERE direction = 'automated' AND twilio_call_sid IS NULL AND ended_at IS NULL
         AND started_at < now() - interval '${UNDER_WAY_MINUTES} minutes'
       RETURNING id, lead_id
     )
     ${activityInsertSql}
     SELECT NULL::int, 'call.ended', lead_id, NULL::int,
            jsonb_build_object('callId', id, 'direction', 'automated', 'outcome', 'failed', 'reason', 'no_webhook')
     FROM closed`
  );
  return rowCount ?? 0;
}

/** The advisory lock that keeps the robot to one look at a time, whatever runs it. */
const DIAL_LOCK = 'auto_dial';

/**
 * Runs `look` holding the dial lock, or not at all - null - when another worker
 * holds it: two looks at once would each see the same room and the same leads.
 * (The same lead is never called twice regardless - `startAutomatedCall` locks
 * it, and the database allows one automated call per lead.)
 */
export async function withDialLock<T>(look: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  let locked: boolean;
  try {
    locked = (await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [DIAL_LOCK])).rows[0].locked;
  } catch (err) {
    client.release(err as Error);
    throw err;
  }
  if (!locked) {
    client.release();
    return null;
  }
  try {
    return await look();
  } finally {
    // A connection whose lock could not be let go is thrown away, never handed
    // back to the pool still holding it - every later look would find it
    // held; and the look's own error, if any, is the one that is thrown.
    let stuck: Error | undefined;
    try {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [DIAL_LOCK]);
    } catch (err) {
      stuck = err as Error;
    }
    client.release(stuck);
  }
}
