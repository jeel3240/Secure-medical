/**
 * The automated call's script in the database - docs/AUTO-CALLS.md, migration
 * 015. This file reads it; `core/call-script.ts` says what it is.
 *
 * Read on every call, never cached, as the SMS flow is (db/flows.ts): a script
 * is changed by a migration, and the change should apply to the next call
 * rather than after a restart.
 */

import { DEFAULT_CALL_HOURS, parseClock, parseDays, type CallHours } from '../core/auto-dial';
import type { CallChoice, CallEnding, CallScript, CallStep } from '../core/call-script';
import type { Db } from './flows';
import { isTimeZone } from './sql';

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

/** How long a lead on hold rings the person who came free - `auto_call_offer_ring_seconds`, T17. */
export const DEFAULT_OFFER_RING_SECONDS = 20;

/**
 * `settings.auto_call_offer_ring_seconds`, read on every offer: 20 when it is
 * missing or not between 5 and 60 seconds.
 */
export async function readOfferRingSeconds(q: Db): Promise<number> {
  const { rows } = await q.query(`SELECT value FROM settings WHERE key = 'auto_call_offer_ring_seconds'`);
  const value = Number(rows[0]?.value);
  return Number.isInteger(value) && value >= 5 && value <= 60 ? value : DEFAULT_OFFER_RING_SECONDS;
}

/** The hold line's safety stop - `auto_call_hold_max_minutes`, T16. */
export const DEFAULT_HOLD_MAX_MINUTES = 10;

/**
 * `settings.auto_call_hold_max_minutes`, in seconds, read on every hold check:
 * 10 minutes when it is missing or not 1-60.
 */
export async function readHoldMaxSeconds(q: Db): Promise<number> {
  const { rows } = await q.query(`SELECT value FROM settings WHERE key = 'auto_call_hold_max_minutes'`);
  const value = Number(rows[0]?.value);
  return (Number.isInteger(value) && value >= 1 && value <= 60 ? value : DEFAULT_HOLD_MAX_MINUTES) * 60;
}

/**
 * When the robot calls - T20: `auto_call_hours_start`, `_hours_end`,
 * `_time_zone`, `_days` and `_wait_minutes`, read on every look so a change by
 * migration applies at once. Each one missing or malformed is migration 015's
 * value (`DEFAULT_CALL_HOURS`) - a typo is never a reason to call at another
 * time - and so is a window that ends before it starts.
 */
export async function readCallHours(q: Db): Promise<CallHours> {
  const { rows } = await q.query(
    `SELECT key, value FROM settings
     WHERE key IN ('auto_call_hours_start', 'auto_call_hours_end', 'auto_call_time_zone', 'auto_call_days', 'auto_call_wait_minutes')`
  );
  const value = (key: string) => rows.find((r) => r.key === key)?.value as string | undefined;
  const start = parseClock(value('auto_call_hours_start'));
  const end = parseClock(value('auto_call_hours_end'));
  const window = start !== null && end !== null && start < end;
  const zone = value('auto_call_time_zone');
  const wait = Number(value('auto_call_wait_minutes'));
  return {
    startMinute: window ? start : DEFAULT_CALL_HOURS.startMinute,
    endMinute: window ? end : DEFAULT_CALL_HOURS.endMinute,
    timeZone: isTimeZone(zone) ? zone : DEFAULT_CALL_HOURS.timeZone,
    days: parseDays(value('auto_call_days')) ?? DEFAULT_CALL_HOURS.days,
    waitMinutes: Number.isInteger(wait) && wait >= 1 && wait <= 7 * 24 * 60 ? wait : DEFAULT_CALL_HOURS.waitMinutes,
  };
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
            busy_body, hold_body, hold_next_body, hold_place_body, link_text
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
    holdNextBody: script.hold_next_body,
    holdPlaceBody: script.hold_place_body,
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
