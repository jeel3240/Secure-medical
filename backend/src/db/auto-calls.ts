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
import {
  onVerdict,
  type AnswerRecord,
  type CallResult,
  type MachineVerdict,
  type VerdictAction,
} from '../core/call-script';
import { activityInsertSql, recordActivity } from './activity';
import { TAKEN_BY_VERDICT_SQL } from './calls';
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
 *   `dnc.blocked` record) - only if it is not blocked already - and the
 *   lead's open text conversation ended (`suppressed`): the same end state as
 *   a STOP text or an agent's DNC (`db/dispositions.ts`), so a later START is
 *   never read as an answer to a question nobody is asking.
 *
 * `kept` is whether an answer row was written: false for a repeated request,
 * and for an answer with no step to keep it under - so what an answer leads
 * to outside the database, the link's text (T14), happens once. `leadId` is
 * the call's lead; null when the row is not an automated call.
 * `takenByVerdict`: Twilio's verdict has handed the call to the voicemail
 * message, or hung up on a fax (T18) - nothing is kept, and nothing should
 * follow from it.
 */
export async function keepAnswer(opts: {
  callId: number;
  step: { id: number; key: string } | null;
  attempt: 1 | 2;
  spoken: SpokenAnswer;
  record: AnswerRecord | null;
  result: CallResult | null;
  blockNumber: boolean;
}): Promise<{ kept: boolean; leadId: number | null; takenByVerdict: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ lead_id: number; phone: string; taken: boolean }>(
      `SELECT c.lead_id, l.phone, ${TAKEN_BY_VERDICT_SQL} AS taken
       FROM calls c JOIN leads l ON l.id = c.lead_id
       WHERE c.id = $1 AND c.direction = 'automated'
       FOR UPDATE OF c`,
      [opts.callId]
    );
    const call = rows[0];
    if (!call) {
      await client.query('ROLLBACK');
      return { kept: false, leadId: null, takenByVerdict: false };
    }
    // The call is the voicemail message's now (T18): what Twilio sends after
    // is the greeting, or the page it replaced - never the lead's answer.
    if (call.taken) {
      await client.query('ROLLBACK');
      return { kept: false, leadId: call.lead_id, takenByVerdict: true };
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
      await client.query(
        `UPDATE conversations SET status = 'suppressed', updated_at = now() WHERE lead_id = $1 AND status = 'open'`,
        [call.lead_id]
      );
    }

    await client.query('COMMIT');
    return { kept, leadId: call.lead_id, takenByVerdict: false };
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
  // A lead who hung up on hold had said yes and reached nobody: an agent
  // calls them back, as when nobody took the ring (T16).
  await pool.query(
    `UPDATE calls
     SET script_result = CASE
       WHEN held_at IS NOT NULL THEN 'transfer_missed'
       WHEN outcome IN ('answered', 'voicemail') THEN 'hung_up'
       ELSE 'unanswered'
     END
     WHERE id = $1 AND direction = 'automated' AND script_result IS NULL AND outcome IS NOT NULL`,
    [callId]
  );
}

/**
 * Acts on Twilio's verdict on who answered the automated call `callId` - T18,
 * AUTO-CALLS.md "Voicemail". The call is locked while it decides
 * (`onVerdict`), so an answer kept at the same moment (`keepAnswer`) is either
 * seen or waits. A takeover - the message, or hanging up on a fax - saves its
 * result first, `voicemail_left` or `unanswered`, and ends a ring from hold it
 * cuts short (`call_offers`, `failed`); all of it is kept only once `takeOver`
 * says Twilio has taken the call: refused - the call already over - nothing
 * is saved, and the call's end gives it its result as for any other.
 * Null when the row is not a live automated call of ours.
 */
export async function actOnVerdict(
  callId: number,
  verdict: MachineVerdict,
  takeOver: (action: Exclude<VerdictAction, 'carry_on'>, callSid: string) => Promise<boolean>
): Promise<{ action: VerdictAction; tookOver: boolean } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      twilio_call_sid: string | null;
      ended: boolean;
      agent_took: boolean;
      key_pressed: boolean;
      answered: boolean;
    }>(
      `SELECT c.twilio_call_sid,
              c.script_result IS NOT NULL OR c.ended_at IS NOT NULL AS ended,
              c.agent_id IS NOT NULL AS agent_took,
              EXISTS (SELECT 1 FROM call_answers a WHERE a.call_id = c.id AND a.digits IS NOT NULL) AS key_pressed,
              EXISTS (SELECT 1 FROM call_answers a WHERE a.call_id = c.id AND a.result = 'choice') AS answered
       FROM calls c
       WHERE c.id = $1 AND c.direction = 'automated'
       FOR UPDATE`,
      [callId]
    );
    const call = rows[0];
    if (!call?.twilio_call_sid) {
      await client.query('ROLLBACK');
      return null;
    }
    const action = onVerdict(verdict, {
      ended: call.ended,
      agentTook: call.agent_took,
      keyPressed: call.key_pressed,
      answered: call.answered,
    });
    if (action === 'carry_on') {
      await client.query('ROLLBACK');
      return { action, tookOver: false };
    }
    await client.query(`UPDATE calls SET script_result = $2 WHERE id = $1 AND script_result IS NULL`, [
      callId,
      action === 'voicemail' ? 'voicemail_left' : 'unanswered',
    ]);
    // A ring from hold cut short by the takeover (T17): over now, so its
    // person is free for another lead at once, not after the stale sweep.
    await client.query(
      `UPDATE call_offers SET ended_at = now(), outcome = 'failed' WHERE call_id = $1 AND ended_at IS NULL`,
      [callId]
    );
    const tookOver = await takeOver(action, call.twilio_call_sid);
    await client.query(tookOver ? 'COMMIT' : 'ROLLBACK');
    return { action, tookOver };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Whether Twilio's verdict has taken the automated call `callId` over - the
 * voicemail message, or a fax hung up on (T18). A request Twilio sends after
 * that is the page the takeover replaced, and changes nothing.
 */
export async function takenByVerdict(callId: number): Promise<boolean> {
  const { rows } = await pool.query<{ taken: boolean }>(
    `SELECT ${TAKEN_BY_VERDICT_SQL} AS taken FROM calls WHERE id = $1 AND direction = 'automated'`,
    [callId]
  );
  return rows[0]?.taken === true;
}

/**
 * A call waiting on hold: it went on hold, has no result yet, and has not
 * ended - T16. `c` is `calls`.
 */
export const ON_HOLD_SQL = `(c.held_at IS NOT NULL AND c.script_result IS NULL AND c.outcome IS NULL)`;

/**
 * Puts the automated call `callId` on hold - T16, AUTO-CALLS.md "The hold
 * line". The time is kept from the first time, so the safety stop counts from
 * then; `call.held` is recorded with it, in the same statement. True the first
 * time.
 */
export async function holdCall(callId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `WITH held AS (
       UPDATE calls SET held_at = now()
       WHERE id = $1 AND direction = 'automated' AND held_at IS NULL AND script_result IS NULL
       RETURNING id, lead_id
     )
     ${activityInsertSql}
     SELECT NULL, 'call.held', held.lead_id, NULL, jsonb_build_object('callId', held.id) FROM held
     RETURNING id`,
    [callId]
  );
  return rows.length > 0;
}

/**
 * The automated call `callId` on hold: how long it has waited, and its place
 * in line among every call waiting - first on hold, first in line. Null when
 * it is not waiting: never held, taken, given its result, or ended.
 */
export async function holdState(callId: number): Promise<{ waitedSeconds: number; place: number } | null> {
  const { rows } = await pool.query<{ waited: number; place: number }>(
    `SELECT extract(epoch FROM now() - c.held_at)::int AS waited,
            (SELECT count(*) FROM calls o
             WHERE o.held_at IS NOT NULL AND o.script_result IS NULL AND o.outcome IS NULL
               AND (o.held_at, o.id) < (c.held_at, c.id))::int + 1 AS place
     FROM calls c
     WHERE c.id = $1 AND c.direction = 'automated' AND ${ON_HOLD_SQL}`,
    [callId]
  );
  return rows[0] ? { waitedSeconds: rows[0].waited, place: rows[0].place } : null;
}

/**
 * Every call waiting on hold, first in line first - what the hold watcher
 * looks at (T16); `offerLive` when it is ringing someone who came free (T17).
 */
export async function callsOnHold(): Promise<{ callId: number; callSid: string; waitedSeconds: number; offerLive: boolean }[]> {
  const { rows } = await pool.query<{ id: number; twilio_call_sid: string; waited: number; offer_live: boolean }>(
    `SELECT c.id, c.twilio_call_sid, extract(epoch FROM now() - c.held_at)::int AS waited,
            EXISTS (SELECT 1 FROM call_offers o WHERE o.call_id = c.id AND o.ended_at IS NULL) AS offer_live
     FROM calls c
     WHERE c.direction = 'automated' AND c.twilio_call_sid IS NOT NULL AND ${ON_HOLD_SQL}
     ORDER BY c.held_at, c.id`
  );
  return rows.map((r) => ({ callId: r.id, callSid: r.twilio_call_sid, waitedSeconds: r.waited, offerLive: r.offer_live }));
}

/** What a transfer needs to know about its automated call - `transferContext`. */
export interface TransferContext {
  /** As a ring says who is calling - `ringAgentTwiml`'s same three. */
  lead: { id: number; name: string; phone: string };
  /** The agent holding the lead now, rung first if free (T15b) - or null. */
  heldBy: number | null;
  /** The step of the lead's last chosen answer - the "yes" being put through; a ring shows its heading. */
  yesStepId: number | null;
}

/**
 * What a transfer needs to know about the automated call `callId` (T15a,
 * T15b), read as the lead says yes. Null when the row is not an automated
 * call.
 */
export async function transferContext(callId: number): Promise<TransferContext | null> {
  const { rows } = await pool.query<{
    id: number;
    first_name: string | null;
    last_name: string | null;
    phone: string;
    assigned_to: number | null;
    yes_step_id: number | null;
  }>(
    `SELECT l.id, l.first_name, l.last_name, l.phone, l.assigned_to,
            (SELECT a.step_id FROM call_answers a
             WHERE a.call_id = c.id AND a.result = 'choice' ORDER BY a.id DESC LIMIT 1) AS yes_step_id
     FROM calls c JOIN leads l ON l.id = c.lead_id
     WHERE c.id = $1 AND c.direction = 'automated'`,
    [callId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    lead: { id: row.id, name: [row.first_name, row.last_name].filter(Boolean).join(' '), phone: row.phone },
    heldBy: row.assigned_to,
    yesStepId: row.yes_step_id,
  };
}

export type TakeTransferResult =
  | { ok: true; leadId: number; tookOverFrom: number | null }
  /** `taken`: another person has it; `inactive`: this account was deactivated while it rang. */
  | { ok: false; reason: 'not_found' | 'taken' | 'inactive' };

/**
 * `agentId` accepted the transfer of the automated call `callId` - T15a, in
 * one transaction, both rows locked:
 *
 * - the call becomes theirs (`agent_id`) and `transferred`, from which it
 *   counts as a person's work - Working, a missed call returned (T4);
 * - the lead becomes theirs, **taking over from anyone who held it** - unlike
 *   an agent picking a lead up, a lead who said yes goes to whoever answered
 *   (Jeel, 2026-10-15). `lead.picked_up` records it, with the call and who it
 *   was taken from. Already theirs - their own lead, or their browser picked it
 *   up a moment before this request arrived - no new pick-up;
 * - and `call.transferred` records taking the transfer itself, whoever held
 *   the lead: without it, a holder taking their own lead's transfer, or a
 *   browser's pick-up arriving first, would leave no record that a transfer
 *   was taken (found on the first real transfer, 2026-10-20).
 *
 * The same request again changes nothing and records nothing. A call another person has already
 * taken is refused: Twilio connects only the first to accept, so a second is
 * a mistake, not a race to settle.
 */
export async function takeTransfer(callId: number, agentId: number): Promise<TakeTransferResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ lead_id: number; agent_id: number | null; assigned_to: number | null }>(
      `SELECT c.lead_id, c.agent_id, l.assigned_to
       FROM calls c JOIN leads l ON l.id = c.lead_id
       WHERE c.id = $1 AND c.direction = 'automated'
       FOR UPDATE OF c, l`,
      [callId]
    );
    const call = rows[0];
    const refuse = async (reason: 'not_found' | 'taken' | 'inactive') => {
      await client.query('ROLLBACK');
      return { ok: false as const, reason };
    };
    if (!call) return await refuse('not_found');
    if (call.agent_id !== null && call.agent_id !== agentId) return await refuse('taken');
    const agent = await client.query(`SELECT 1 FROM users WHERE id = $1 AND is_active`, [agentId]);
    if (agent.rowCount === 0) return await refuse('inactive');

    const firstTime = call.agent_id === null;
    await client.query(
      `UPDATE calls SET agent_id = $2, script_result = COALESCE(script_result, 'transferred') WHERE id = $1`,
      [callId, agentId]
    );
    // Taken from hold, offered to them (T17): that offer ended, taken.
    await client.query(
      `UPDATE call_offers SET ended_at = now(), outcome = 'taken'
       WHERE call_id = $1 AND agent_id = $2 AND ended_at IS NULL`,
      [callId, agentId]
    );
    const tookOverFrom = call.assigned_to !== null && call.assigned_to !== agentId ? call.assigned_to : null;
    if (firstTime) {
      await recordActivity(client, {
        action: 'call.transferred',
        actorId: agentId,
        leadId: call.lead_id,
        detail: { callId, ...(tookOverFrom === null ? {} : { tookOverFrom }) },
      });
    }
    if (call.assigned_to !== agentId) {
      await client.query(`UPDATE leads SET assigned_to = $2, assigned_at = now(), updated_at = now() WHERE id = $1`, [
        call.lead_id,
        agentId,
      ]);
      await recordActivity(client, {
        action: 'lead.picked_up',
        actorId: agentId,
        leadId: call.lead_id,
        detail: { via: 'transfer', callId, ...(tookOverFrom === null ? {} : { tookOverFrom }) },
      });
    }

    await client.query('COMMIT');
    return { ok: true, leadId: call.lead_id, tookOverFrom };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Nobody took the transfer - T15a: the call ends as `transfer_missed`, unless
 * it already has a result. An agent calls the lead back; T22 puts them first.
 */
export async function missTransfer(callId: number): Promise<void> {
  await pool.query(
    `UPDATE calls SET script_result = 'transfer_missed'
     WHERE id = $1 AND direction = 'automated' AND script_result IS NULL`,
    [callId]
  );
}
