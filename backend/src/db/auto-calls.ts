/**
 * The automated call in the database - T12, docs/AUTO-CALLS.md, migration 014.
 *
 * A call the server places is a `calls` row with `direction = 'automated'` and
 * no agent. The row is written before Twilio is asked, so no call is ever
 * placed without one. Twilio's id for the call is added when Twilio answers -
 * or, if that answer never came, by the first webhook about the call, since
 * each webhook names the row by its id (`?call=`) in an address Twilio signs.
 *
 * How the call ends is saved by `finishCall` (`db/calls.ts`), as for every
 * call: it already treats an automated call as nobody's work (T4).
 */

import { activityInsertSql, recordActivity } from './activity';
import { pool } from './pool';

/**
 * Why an automated call was not placed:
 *
 * - `not_found` - no such lead;
 * - `blocked` - the number is on the do-not-call list;
 * - `already_called` - one automated call per lead (decided 2026-10-17; the
 *   database refuses a second, `calls_one_automated_per_lead`);
 * - `no_script` - no call script is active, so there is nothing to say;
 * - `not_test_number` - outside production, the number is not one of ours
 *   (`AUTO_CALL_TEST_NUMBERS`).
 */
export type AutoCallRefusal = 'not_found' | 'blocked' | 'already_called' | 'no_script' | 'not_test_number';

export type StartAutoCallResult = { ok: true; callId: number; phone: string } | { ok: false; reason: AutoCallRefusal };

/**
 * Checks the lead may be called and writes the call's row, in one
 * transaction. The lead row is locked, so a do-not-call block or a second
 * call cannot land between the check and the insert. `mayRing` is the test
 * numbers outside production (`auto-calls-settings.ts`).
 *
 * A refusal writes no row; its `call.refused` record is the only trace, as
 * for an agent's refused call.
 */
export async function startAutomatedCall(opts: {
  leadId: number;
  mayRing: (phone: string) => boolean;
}): Promise<StartAutoCallResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ phone: string; blocked: boolean; called: boolean; scripted: boolean }>(
      `SELECT l.phone,
              EXISTS (SELECT 1 FROM dnc_list d WHERE d.phone = l.phone AND d.released_at IS NULL) AS blocked,
              EXISTS (SELECT 1 FROM calls c WHERE c.lead_id = l.id AND c.direction = 'automated') AS called,
              EXISTS (SELECT 1 FROM call_scripts s WHERE s.is_active) AS scripted
       FROM leads l
       WHERE l.id = $1
       FOR UPDATE OF l`,
      [opts.leadId]
    );

    const lead = rows[0];
    const refusal: AutoCallRefusal | null = !lead
      ? 'not_found'
      : lead.blocked
        ? 'blocked'
        : lead.called
          ? 'already_called'
          : !lead.scripted
            ? 'no_script'
            : !opts.mayRing(lead.phone)
              ? 'not_test_number'
              : null;

    if (refusal) {
      // An unknown lead has no row to point at; its id is kept in the detail.
      await recordActivity(client, {
        action: 'call.refused',
        actorId: null,
        leadId: lead ? opts.leadId : null,
        detail: { reason: refusal, direction: 'automated', ...(lead ? {} : { leadId: opts.leadId }) },
      });
      await client.query('COMMIT');
      return { ok: false, reason: refusal };
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO calls (lead_id, direction, started_at) VALUES ($1, 'automated', now()) RETURNING id`,
      [opts.leadId]
    );
    const callId = inserted.rows[0].id;
    await recordActivity(client, {
      action: 'call.started',
      actorId: null,
      leadId: opts.leadId,
      detail: { callId, direction: 'automated' },
    });

    await client.query('COMMIT');
    return { ok: true, callId, phone: lead.phone };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Whether Twilio's call `callSid` is our automated call `callId` - saving the
 * id on the row when the row has none yet. False for a row that is not an
 * automated call, or that is another call's: a webhook naming it is then not
 * acted on.
 */
export async function linkAutomatedCall(callId: number, callSid: string): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE calls
     SET twilio_call_sid = $2
     WHERE id = $1 AND direction = 'automated' AND (twilio_call_sid IS NULL OR twilio_call_sid = $2)
     RETURNING id`,
    [callId, callSid]
  );
  return rows.length === 1;
}

/**
 * Twilio refused to place the call, so it never rang: the row is ended as
 * `failed`, with Twilio's status and error code, and its `call.ended` record
 * written in the same statement. Only once - an ended row is left alone.
 */
export async function failAutomatedCall(
  callId: number,
  twilio: { status: number; code: number | null }
): Promise<void> {
  await pool.query(
    `WITH failed AS (
       UPDATE calls SET outcome = 'failed', duration_sec = 0, ended_at = now()
       WHERE id = $1 AND direction = 'automated' AND ended_at IS NULL
       RETURNING id, lead_id
     )
     ${activityInsertSql}
     SELECT NULL::int, 'call.ended', lead_id, NULL::int,
            jsonb_build_object('callId', id, 'direction', 'automated', 'outcome', 'failed',
                               'reason', 'twilio_refused', 'twilioStatus', $2::int, 'twilioCode', $3::int)
     FROM failed`,
    [callId, twilio.status, twilio.code]
  );
}
