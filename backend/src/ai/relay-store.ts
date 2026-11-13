/**
 * The relay's database - A10 and A11, docs/AI-AGENT.md sections 3 and 9.
 *
 * Seri takes a call once: `startAiCall` marks the row and records it in one
 * transaction, and only for the automated call Twilio's `setup` names. Every
 * turn is then one add-only `call_ai_turns` row. The words are kept here and
 * never in the logs. Before each reply, who could take the call now - the same
 * rules the transfer itself follows - and once, how her part ended
 * (`endAiCall`).
 */

import type { Pool } from 'pg';
import type { CallHours } from '../core/auto-dial';
import type { CallScript } from '../core/call-script';
import { recordActivity } from '../db/activity';
import { loadActiveCallScript, readCallHours } from '../db/call-script';
import type { Db } from '../db/flows';
import { freePeople, someoneOnOrJustOffCall } from '../db/presence';
import type { Handoff } from './actions';
import type { WhoIsThere } from './instructions';

/** The call Seri has just taken, and what she needs to know of the lead. */
export interface AiCall {
  callId: number;
  leadId: number;
  firstName: string | null;
  phone: string;
}

/** Why a `setup` does not start Seri. */
export type StartRefusal =
  | 'no_such_call'
  /** An agent's call, or a lead calling in: never hers. */
  | 'not_automated'
  /** The row is another Twilio call's: the `<Parameter>` and the call disagree. */
  | 'other_call'
  /** She already took it: a second connection for the same call. */
  | 'already_started'
  /** It has ended, or the script has a result for it. */
  | 'over';

export type StartResult = { ok: true; call: AiCall } | { ok: false; reason: StartRefusal };

export type TurnWho = 'lead' | 'seri' | 'action' | 'system';

export interface Turn {
  callId: number;
  who: TurnWho;
  text: string;
  /** Seri's turns only: how long she took to start. */
  latencyMs?: number | null;
}

/** What a call of hers reads once, at the start: the script's stop line and words, and the agents' hours. */
export interface CallSettings {
  script: CallScript | null;
  hours: CallHours;
}

/** What the relay needs of the database - faked in its tests. */
export interface RelayStore {
  startAiCall(input: { callId: number; callSid: string; knowledgeVersion: string }): Promise<StartResult>;
  saveTurn(turn: Turn): Promise<void>;
  callSettings(): Promise<CallSettings>;
  whoIsThere(callId: number): Promise<WhoIsThere>;
  endAiCall(callId: number, handoff: Handoff): Promise<boolean>;
}

/**
 * Marks the call as Seri's - `ai_started_at` and the knowledge version she
 * uses - and records `ai_agent.started`, together. One UPDATE decides, so two
 * connections for one call cannot both start it.
 */
export async function startAiCall(
  pool: Pool,
  input: { callId: number; callSid: string; knowledgeVersion: string }
): Promise<StartResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE calls c
          SET ai_started_at = now(), ai_knowledge_version = $3
         FROM leads l
        WHERE c.id = $1
          AND l.id = c.lead_id
          AND c.direction = 'automated'
          AND c.twilio_call_sid = $2
          AND c.ai_started_at IS NULL
          AND c.ended_at IS NULL
          AND c.script_result IS NULL
        RETURNING c.id AS "callId", c.lead_id AS "leadId", l.first_name AS "firstName", l.phone`,
      [input.callId, input.callSid, input.knowledgeVersion]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: await whyNotStarted(pool, input) };
    }
    const call = rows[0] as AiCall;
    await recordActivity(client, {
      action: 'ai_agent.started',
      actorId: null,
      leadId: call.leadId,
      detail: { callId: call.callId, knowledgeVersion: input.knowledgeVersion },
    });
    await client.query('COMMIT');
    return { ok: true, call };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** For the log: which of the UPDATE's conditions failed. */
async function whyNotStarted(q: Db, input: { callId: number; callSid: string }): Promise<StartRefusal> {
  const { rows } = await q.query(
    `SELECT direction, twilio_call_sid, ai_started_at, ended_at, script_result FROM calls WHERE id = $1`,
    [input.callId]
  );
  const c = rows[0];
  if (!c) return 'no_such_call';
  if (c.direction !== 'automated') return 'not_automated';
  if (c.twilio_call_sid !== input.callSid) return 'other_call';
  if (c.ai_started_at !== null) return 'already_started';
  return 'over';
}

export async function saveTurn(q: Db, turn: Turn): Promise<void> {
  await q.query(`INSERT INTO call_ai_turns (call_id, who, text, latency_ms) VALUES ($1, $2, $3, $4)`, [
    turn.callId,
    turn.who,
    turn.text,
    turn.latencyMs ?? null,
  ]);
}

/**
 * Who could take the call now - section 3, with the transfer's own rules, so
 * what she is told is what the transfer will find: someone free (`FREE_SQL`);
 * nobody free, but someone on a call or writing its note, or another robot
 * call's transfer ringing - the hold line (T16, T17); or nobody - the busy line.
 */
export async function whoIsThere(q: Db, callId: number): Promise<WhoIsThere> {
  const [free, coming] = await Promise.all([freePeople(q), someoneOnOrJustOffCall(q, callId)]);
  if (free.length > 0) return 'free';
  return coming ? 'coming' : 'nobody';
}

/**
 * How her part of the call ended - `ai_ended_with` - and `ai_agent.ended`,
 * together. Once: false when it was already recorded, or she never started.
 * A `fallback` is written here too, with why (A12): the robot counts them (A17).
 */
export async function endAiCall(pool: Pool, callId: number, handoff: Handoff): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE calls SET ai_ended_with = $2
        WHERE id = $1 AND ai_started_at IS NOT NULL AND ai_ended_with IS NULL
        RETURNING lead_id AS "leadId"`,
      [callId, handoff.action]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await recordActivity(client, {
      action: 'ai_agent.ended',
      actorId: null,
      leadId: rows[0].leadId,
      detail: {
        callId,
        action: handoff.action,
        ...(handoff.action === 'end_call' ? { reason: handoff.reason } : {}),
        ...(handoff.action === 'fallback' ? { why: handoff.why } : {}),
      },
    });
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function pgRelayStore(pool: Pool): RelayStore {
  return {
    startAiCall: (input) => startAiCall(pool, input),
    saveTurn: (turn) => saveTurn(pool, turn),
    callSettings: async () => {
      const [script, hours] = await Promise.all([loadActiveCallScript(pool), readCallHours(pool)]);
      return { script, hours };
    },
    whoIsThere: (callId) => whoIsThere(pool, callId),
    endAiCall: (callId, handoff) => endAiCall(pool, callId, handoff),
  };
}
