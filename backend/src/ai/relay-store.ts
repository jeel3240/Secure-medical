/**
 * The relay's database - A10, docs/AI-AGENT.md section 9.
 *
 * Seri takes a call once: `startAiCall` marks the row and records it in one
 * transaction, and only for the automated call Twilio's `setup` names. Every
 * turn is then one add-only `call_ai_turns` row. The words are kept here and
 * never in the logs.
 */

import type { Pool } from 'pg';
import { recordActivity } from '../db/activity';
import type { Db } from '../db/flows';

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

/** What the relay needs of the database - faked in its tests. */
export interface RelayStore {
  startAiCall(input: { callId: number; callSid: string; knowledgeVersion: string }): Promise<StartResult>;
  saveTurn(turn: Turn): Promise<void>;
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

export function pgRelayStore(pool: Pool): RelayStore {
  return {
    startAiCall: (input) => startAiCall(pool, input),
    saveTurn: (turn) => saveTurn(pool, turn),
  };
}
