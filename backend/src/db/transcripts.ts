/**
 * Call recordings and transcripts in the database - TWILIO.md, "Recordings and
 * transcripts". Migration 011.
 *
 * Every write records itself in the activity log in the same statement
 * (docs/AUDIT.md): a recording arriving, a transcript completing, one failing.
 */

import { activityInsertSql } from './activity';
import { pool } from './pool';
import { MAX_TRANSCRIPT_ATTEMPTS, TRANSCRIPT_GIVE_UP_HOURS, type TranscriptLine } from '../core/transcripts';

/**
 * Keeps a finished recording against its call, and puts a transcript in line
 * for the worker. Idempotent: Twilio retries the callback, and a repeat finds
 * the recording already there and does nothing.
 */
export async function saveRecording(opts: {
  callSid: string;
  recordingSid: string;
  durationSec: number;
  channels: number;
}): Promise<boolean> {
  const { rowCount } = await pool.query(
    `WITH kept AS (
       INSERT INTO call_recordings (call_id, recording_sid, duration_sec, channels)
       SELECT id, $2, $3, $4 FROM calls WHERE twilio_call_sid = $1
       ON CONFLICT (recording_sid) DO NOTHING
       RETURNING id, call_id
     ),
     queued AS (
       INSERT INTO call_transcripts (call_id, recording_id)
       SELECT call_id, id FROM kept
       RETURNING id
     ),
     logged AS (
       ${activityInsertSql}
       SELECT NULL::int, 'call.recorded', c.lead_id, c.agent_id,
              jsonb_build_object('callId', c.id, 'callSid', $1::text, 'recordingSid', $2::text, 'durationSec', $3::int)
       FROM kept JOIN calls c ON c.id = kept.call_id
     )
     SELECT 1 FROM kept`,
    [opts.callSid, opts.recordingSid, opts.durationSec, opts.channels]
  );
  return rowCount === 1;
}

/** A transcript the worker still has work on. */
export interface OpenTranscript {
  id: number;
  callId: number;
  direction: 'outbound' | 'inbound';
  recordingSid: string;
  status: 'pending' | 'queued';
  transcriptSid: string | null;
  attempts: number;
  /** Older than the give-up limit: stop asking. */
  tooOld: boolean;
}

export async function openTranscripts(limit = 20): Promise<OpenTranscript[]> {
  const { rows } = await pool.query(
    `SELECT t.id, t.call_id, c.direction, r.recording_sid, t.status, t.transcript_sid, t.attempts,
            t.created_at < now() - ($2 || ' hours')::interval AS too_old
     FROM call_transcripts t
     JOIN call_recordings r ON r.id = t.recording_id
     JOIN calls c ON c.id = t.call_id
     WHERE t.status IN ('pending', 'queued')
     ORDER BY t.id
     LIMIT $1`,
    [limit, String(TRANSCRIPT_GIVE_UP_HOURS)]
  );
  return rows.map((r) => ({
    id: r.id,
    callId: r.call_id,
    direction: r.direction,
    recordingSid: r.recording_sid,
    status: r.status,
    transcriptSid: r.transcript_sid,
    attempts: r.attempts,
    tooOld: r.too_old,
  }));
}

/** Twilio has accepted it. */
export async function markQueued(id: number, transcriptSid: string): Promise<void> {
  await pool.query(
    `UPDATE call_transcripts SET status = 'queued', transcript_sid = $2, attempts = attempts + 1, error = NULL, updated_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [id, transcriptSid]
  );
}

/**
 * Twilio would not take it this time. Tried again next tick, up to
 * MAX_TRANSCRIPT_ATTEMPTS; then failed for good.
 */
export async function markAttemptFailed(id: number, error: string): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE call_transcripts SET attempts = attempts + 1, error = $2, updated_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING attempts`,
    [id, error.slice(0, 500)]
  );
  const gaveUp = rows.length === 1 && rows[0].attempts >= MAX_TRANSCRIPT_ATTEMPTS;
  if (gaveUp) await markFailed(id, `gave up after ${MAX_TRANSCRIPT_ATTEMPTS} attempts: ${error}`);
  return gaveUp;
}

/** The text is in. Written once: a transcript that is already complete is left alone. */
export async function markCompleted(id: number, lines: TranscriptLine[]): Promise<void> {
  await pool.query(
    `WITH done AS (
       UPDATE call_transcripts SET status = 'completed', sentences = $2::jsonb, completed_at = now(), updated_at = now()
       WHERE id = $1 AND status IN ('pending', 'queued')
       RETURNING id, call_id, transcript_sid
     )
     ${activityInsertSql}
     SELECT NULL::int, 'call.transcribed', c.lead_id, c.agent_id,
            jsonb_build_object('callId', c.id, 'transcriptSid', done.transcript_sid, 'lines', $3::int)
     FROM done JOIN calls c ON c.id = done.call_id`,
    [id, JSON.stringify(lines), lines.length]
  );
}

export async function markFailed(id: number, reason: string): Promise<void> {
  await pool.query(
    `WITH gone AS (
       UPDATE call_transcripts SET status = 'failed', error = $2, updated_at = now()
       WHERE id = $1 AND status IN ('pending', 'queued')
       RETURNING id, call_id
     )
     ${activityInsertSql}
     SELECT NULL::int, 'call.transcript_failed', c.lead_id, c.agent_id,
            jsonb_build_object('callId', c.id, 'reason', $2::text)
     FROM gone JOIN calls c ON c.id = gone.call_id`,
    [id, reason.slice(0, 500)]
  );
}
