/**
 * The automated call's script in the database - docs/AUTO-CALLS.md, migration
 * 015. This file reads it; `core/call-script.ts` says what it is.
 *
 * Read on every call, never cached, as the SMS flow is (db/flows.ts): a script
 * is changed by a migration, and the change should apply to the next call
 * rather than after a restart.
 */

import type { CallChoice, CallEnding, CallScript, CallStep } from '../core/call-script';
import type { Db } from './flows';

/** Below this, a spoken answer is not trusted - `auto_call_min_confidence`, T7. */
export const DEFAULT_MIN_CONFIDENCE = 0.4;

/**
 * `settings.auto_call_min_confidence`, read on every answer like the script:
 * 0.4 when it is missing or not between 0 and 1.
 */
export async function readMinConfidence(q: Db): Promise<number> {
  const { rows } = await q.query(`SELECT value FROM settings WHERE key = 'auto_call_min_confidence'`);
  const value = Number(rows[0]?.value);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_MIN_CONFIDENCE;
}

/** How long a transfer rings people - `auto_call_ring_seconds`, T15a. */
export const DEFAULT_RING_SECONDS = 25;

/**
 * `settings.auto_call_ring_seconds`, read on every transfer: 25 when it is
 * missing or not between 5 and 60 seconds.
 */
export async function readRingSeconds(q: Db): Promise<number> {
  const { rows } = await q.query(`SELECT value FROM settings WHERE key = 'auto_call_ring_seconds'`);
  const value = Number(rows[0]?.value);
  return Number.isInteger(value) && value >= 5 && value <= 60 ? value : DEFAULT_RING_SECONDS;
}

/** The script calls use - null when there is none. */
export async function loadActiveCallScript(q: Db): Promise<CallScript | null> {
  const { rows } = await q.query(`SELECT id FROM call_scripts WHERE is_active`);
  return rows[0] ? loadCallScript(q, rows[0].id) : null;
}

/** One script, whole. Null when it does not exist. */
export async function loadCallScript(q: Db, scriptId: number): Promise<CallScript | null> {
  // One after another, not together: `q` may be a client inside a transaction,
  // and a client runs one query at a time.
  const scripts = await q.query(
    `SELECT id, key, name, voice, opt_out_words, opt_out_body, no_response_body, voicemail_body,
            busy_body, hold_body, link_text
     FROM call_scripts WHERE id = $1`,
    [scriptId]
  );
  const steps = await q.query(
    `SELECT id, key, position, heading, body, repeat_body
     FROM call_steps WHERE script_id = $1 ORDER BY position`,
    [scriptId]
  );
  const choices = await q.query(
    `SELECT step_id, key, label, words, reply_body, next_step_id, ending
     FROM call_choices WHERE script_id = $1 ORDER BY step_id, key`,
    [scriptId]
  );

  const script = scripts.rows[0];
  if (!script) return null;

  const byStep = new Map<number, CallChoice[]>();
  for (const c of choices.rows) {
    const list = byStep.get(c.step_id) ?? [];
    list.push({
      key: c.key,
      label: c.label,
      words: c.words ?? [],
      reply: c.reply_body,
      nextStepId: c.next_step_id,
      ending: c.ending as CallEnding | null,
    });
    byStep.set(c.step_id, list);
  }

  return {
    id: script.id,
    key: script.key,
    name: script.name,
    voice: script.voice,
    optOutWords: script.opt_out_words ?? [],
    optOutBody: script.opt_out_body,
    noResponseBody: script.no_response_body,
    voicemailBody: script.voicemail_body,
    busyBody: script.busy_body,
    holdBody: script.hold_body,
    linkText: script.link_text,
    steps: steps.rows.map(
      (r): CallStep => ({
        id: r.id,
        key: r.key,
        position: r.position,
        heading: r.heading,
        body: r.body,
        repeatBody: r.repeat_body,
        choices: byStep.get(r.id) ?? [],
      })
    ),
  };
}
