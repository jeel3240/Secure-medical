/**
 * The relay's database - A10 and A11, docs/AI-AGENT.md sections 3 and 9.
 *
 * Seri takes a call once: `startAiCall` marks the row and records it in one
 * transaction, and only for the automated call Twilio's `setup` names. When the
 * line drops and Twilio opens the relay again, `resumeAiCall` gives back the
 * call so far - her turns, and the action she ended with if she had. Every
 * turn is then one add-only `call_ai_turns` row. The words are kept here and
 * never in the logs. Before each reply, who could take the call now - the same
 * rules the transfer itself follows - and once, how her part ended
 * (`endAiCall`) - and, for the page that carries it out, the action she
 * ended with (`recordedHandoff`, A14).
 */

import type { Pool } from 'pg';
import { TAKEN_BY_VERDICT_SQL } from '../db/calls';
import type { CallHours } from '../core/auto-dial';
import type { CallScript } from '../core/call-script';
import { recordActivity } from '../db/activity';
import { loadActiveCallScript, readCallHours } from '../db/call-script';
import type { Db } from '../db/flows';
import { freePeople, someoneOnOrJustOffCall } from '../db/presence';
import { fallbackHandoff, fromHandoff, type Handoff } from './actions';
import type { VerdictState } from './conversation';
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

/** Why a reconnect does not pick a call back up. `not_started`: she never took it - the relay starts it instead. */
export type ResumeRefusal = 'no_such_call' | 'not_automated' | 'other_call' | 'not_started' | 'over';

/** A call picked back up: when she took it, and every turn kept so far, in order. */
export interface Resumed {
  call: AiCall;
  startedAt: Date;
  turns: { who: TurnWho; text: string }[];
  /** The action she had ended with before the line dropped - it is carried out, not talked over again. Null while she was still talking. */
  ended: Handoff | null;
}

export type ResumeResult = ({ ok: true } & Resumed) | { ok: false; reason: ResumeRefusal };

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
  resumeAiCall(input: { callId: number; callSid: string; attempt: number | null }): Promise<ResumeResult>;
  saveTurn(turn: Turn): Promise<void>;
  callSettings(): Promise<CallSettings>;
  whoIsThere(callId: number): Promise<WhoIsThere>;
  endAiCall(callId: number, handoff: Handoff): Promise<boolean>;
  verdict(callId: number): Promise<VerdictState>;
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

/**
 * A call of hers Twilio opened the relay for again, after the line dropped:
 * the call as `startAiCall` left it - the same Twilio call, hers, not over -
 * with its turns, and `ai_agent.reconnected` recorded, together. Any number of
 * times: Twilio reconnects a call up to five times. The row is locked, so a
 * reconnect reads the turns of a call nobody else is ending.
 */
export async function resumeAiCall(
  pool: Pool,
  input: { callId: number; callSid: string; attempt: number | null }
): Promise<ResumeResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT c.id AS "callId", c.lead_id AS "leadId", l.first_name AS "firstName", l.phone,
              c.direction, c.twilio_call_sid AS "callSid", c.ai_started_at AS "startedAt",
              c.ai_ended_with AS "endedWith", c.ended_at IS NOT NULL OR c.script_result IS NOT NULL AS over
         FROM calls c
         JOIN leads l ON l.id = c.lead_id
        WHERE c.id = $1
          FOR UPDATE OF c`,
      [input.callId]
    );
    const c = rows[0];
    const refused: ResumeRefusal | null = !c
      ? 'no_such_call'
      : c.direction !== 'automated'
        ? 'not_automated'
        : c.callSid !== input.callSid
          ? 'other_call'
          : c.startedAt === null
            ? 'not_started'
            : c.over
              ? 'over'
              : null;
    if (refused) {
      await client.query('ROLLBACK');
      return { ok: false, reason: refused };
    }
    const turns = await client.query(`SELECT who, text FROM call_ai_turns WHERE call_id = $1 ORDER BY id`, [input.callId]);
    const lastAction = [...turns.rows].reverse().find((t) => t.who === 'action');
    const ended: Handoff | null = lastAction
      ? fromHandoff(lastAction.text)
      : c.endedWith !== null
        ? fallbackHandoff('ended_before_drop')
        : null;
    await recordActivity(client, {
      action: 'ai_agent.reconnected',
      actorId: null,
      leadId: c.leadId,
      detail: { callId: input.callId, attempt: input.attempt, ended: ended !== null },
    });
    await client.query('COMMIT');
    return {
      ok: true,
      call: { callId: c.callId, leadId: c.leadId, firstName: c.firstName, phone: c.phone },
      startedAt: c.startedAt,
      turns: turns.rows,
      ended,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

/**
 * Twilio's verdict on who answered the call, as an ending action of hers waits
 * on it (A18): not come yet, come - any verdict, `calls.answered_by` - or come
 * and the voicemail message took the call (`TAKEN_BY_VERDICT_SQL`, T18).
 */
export async function verdictState(q: Db, callId: number): Promise<VerdictState> {
  const { rows } = await q.query(
    `SELECT answered_by IS NOT NULL AS known, ${TAKEN_BY_VERDICT_SQL} AS taken FROM calls WHERE id = $1`,
    [callId]
  );
  const r = rows[0];
  if (!r) return 'in';
  return r.taken ? 'taken' : r.known ? 'in' : 'pending';
}

/**
 * The action the relay ended Seri's part with, as it kept it - her `action`
 * turn, its `handoffData` (A14). For a lead who hung up: Twilio then sends no
 * `HandoffData`, but a stop or a link she had already ended with is still
 * carried out. Null when she ended with none - the lead hung up first.
 */
export async function recordedHandoff(q: Db, callId: number): Promise<Handoff | null> {
  const { rows } = await q.query(
    `SELECT text FROM call_ai_turns WHERE call_id = $1 AND who = 'action' ORDER BY id DESC LIMIT 1`,
    [callId]
  );
  return rows[0] ? fromHandoff(rows[0].text) : null;
}

export function pgRelayStore(pool: Pool): RelayStore {
  return {
    startAiCall: (input) => startAiCall(pool, input),
    resumeAiCall: (input) => resumeAiCall(pool, input),
    saveTurn: (turn) => saveTurn(pool, turn),
    callSettings: async () => {
      const [script, hours] = await Promise.all([loadActiveCallScript(pool), readCallHours(pool)]);
      return { script, hours };
    },
    whoIsThere: (callId) => whoIsThere(pool, callId),
    endAiCall: (callId, handoff) => endAiCall(pool, callId, handoff),
    verdict: (callId) => verdictState(pool, callId),
  };
}
