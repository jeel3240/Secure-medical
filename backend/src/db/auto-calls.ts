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

import type { SpokenAnswer } from '../core/answers';
import type { AnswerRecord, CallResult } from '../core/call-script';
import { activityInsertSql, recordActivity } from './activity';
import { blockNumber, DNC_REASONS } from './dnc';
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
 * `failed` and `unanswered`, with Twilio's status and error code, and its
 * `call.ended` record written in the same statement. Only once - an ended row
 * is left alone.
 */
export async function failAutomatedCall(
  callId: number,
  twilio: { status: number; code: number | null }
): Promise<void> {
  await pool.query(
    `WITH failed AS (
       UPDATE calls SET outcome = 'failed', duration_sec = 0, ended_at = now(), script_result = 'unanswered'
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

/** Kept as heard, up to this long - Twilio's own are a sentence at most. */
const MAX_HEARD = 500;

/**
 * Keeps one answer on the automated call `callId` - T13, in one transaction.
 * Each part is safe to repeat, since Twilio may send the same request twice:
 *
 * - the `call_answers` row, once per asking (`UNIQUE (call_id, step_id,
 *   attempt)`);
 * - how the script ended, `result`, only if the call has none yet - never
 *   overwritten;
 * - when the lead said stop, the number blocked (`call_opt_out`, with its
 *   `dnc.blocked` record) - only if it is not blocked already.
 *
 * `kept` is whether an answer row was written: false for a repeated request,
 * and for an answer with no step to keep it under - so what an answer leads
 * to outside the database, the link's text (T14), happens once. `leadId` is
 * the call's lead; null when the row is not an automated call.
 */
export async function keepAnswer(opts: {
  callId: number;
  step: { id: number; key: string } | null;
  attempt: 1 | 2;
  spoken: SpokenAnswer;
  record: AnswerRecord | null;
  result: CallResult | null;
  blockNumber: boolean;
}): Promise<{ kept: boolean; leadId: number | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ lead_id: number; phone: string }>(
      `SELECT c.lead_id, l.phone
       FROM calls c JOIN leads l ON l.id = c.lead_id
       WHERE c.id = $1 AND c.direction = 'automated'
       FOR UPDATE OF c`,
      [opts.callId]
    );
    const call = rows[0];
    if (!call) {
      await client.query('ROLLBACK');
      return { kept: false, leadId: null };
    }

    let kept = false;
    if (opts.record && opts.step) {
      const inserted = await client.query(
        `INSERT INTO call_answers (call_id, lead_id, step_id, step_key, attempt, heard, confidence, digits,
                                   result, choice_key, choice_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (call_id, step_id, attempt) DO NOTHING
         RETURNING id`,
        [
          opts.callId,
          call.lead_id,
          opts.step.id,
          opts.step.key,
          opts.attempt,
          opts.spoken.heard?.trim().slice(0, MAX_HEARD) || null,
          opts.spoken.confidence ?? null,
          opts.spoken.digits?.trim() || null,
          opts.record.result,
          opts.record.choiceKey,
          opts.record.choiceLabel,
        ]
      );
      kept = inserted.rowCount === 1;
    }

    if (opts.result) {
      await client.query(`UPDATE calls SET script_result = $2 WHERE id = $1 AND script_result IS NULL`, [
        opts.callId,
        opts.result,
      ]);
    }
    if (opts.blockNumber) {
      const live = await client.query(`SELECT 1 FROM dnc_list WHERE phone = $1 AND released_at IS NULL`, [call.phone]);
      if (live.rowCount === 0) await blockNumber(client, call.phone, DNC_REASONS.callOptOut);
    }

    await client.query('COMMIT');
    return { kept, leadId: call.lead_id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The call has ended (`/auto/status`): a script that never reached its own
 * end is given one - `unanswered` if the lead never picked up, `hung_up` if
 * they did and left before the script finished. A result already saved is
 * never changed.
 */
export async function settleAutomatedCall(callId: number): Promise<void> {
  await pool.query(
    `UPDATE calls
     SET script_result = CASE WHEN outcome IN ('answered', 'voicemail') THEN 'hung_up' ELSE 'unanswered' END
     WHERE id = $1 AND direction = 'automated' AND script_result IS NULL AND outcome IS NOT NULL`,
    [callId]
  );
}
