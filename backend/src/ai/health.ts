/**
 * Whether Seri can take calls, asked before the robot places any - A17,
 * docs/AI-AGENT.md section 6.
 *
 * Each lead gets one robot call, so a call that reaches a broken Seri spends
 * it on the script's backup at best. Before a look that would place calls,
 * with her switched on:
 *
 * - **OpenAI answers** - a one-word request to her own model (`openAiProbe`),
 *   at most once a minute (`cachedProbe`). An error, a refused key or no answer
 *   in 5 seconds is down: nothing is placed, and it is asked again a minute on.
 * - **Her last three calls did not all fall back** (`fallbackStreak`). Three
 *   in a row, the latest started within the pause - 15 minutes, as the robot
 *   pauses when Twilio refuses (T28) - and nothing is placed; then OpenAI is
 *   checked again, and the next call tells. Each further fallback starts the
 *   pause again.
 *
 * Off - the switch, or no key - none of this is asked: the calls get the
 * script, which needs no OpenAI. The worker wires it (`worker/index.ts`).
 */

import OpenAI from 'openai';
import type { Db } from '../db/flows';
import { SERI_MODEL } from './model';
import { plainError } from './openai';

/** What the robot is told before it places calls. */
export type SeriState =
  | { state: 'off' }
  | { state: 'ready' }
  /** OpenAI did not answer, or refused; `err` is its status and code, never its message (`plainError`). */
  | { state: 'openai_down'; err: string }
  /** Her last three calls all fell back, the latest within the pause. */
  | { state: 'fallbacks' };

/** How long a check of OpenAI is trusted. */
export const PROBE_CACHE_MS = 60_000;
/** How long the check waits for OpenAI's answer. */
export const PROBE_TIMEOUT_MS = 5_000;
/** How many fallbacks in a row pause the robot. */
export const FALLBACK_STREAK = 3;

export type Probe = { ok: true } | { ok: false; err: string };

/**
 * The smallest request that proves what a call needs: her model, answering,
 * for this key - one word, no retries.
 */
export function openAiProbe(apiKey: string): () => Promise<Probe> {
  let client: OpenAI | null = null;
  return async () => {
    client ??= new OpenAI({ apiKey, timeout: PROBE_TIMEOUT_MS, maxRetries: 0 });
    try {
      await client.chat.completions.create({
        model: SERI_MODEL,
        messages: [{ role: 'user', content: 'Say OK.' }],
        max_completion_tokens: 1,
      });
      return { ok: true };
    } catch (err) {
      const plain = plainError(err);
      return { ok: false, err: plain instanceof Error ? plain.message : 'OpenAI failed' };
    }
  };
}

/**
 * A probe asked at most once per `ttlMs`, its answer - up or down - kept in
 * between. Two looks at once share one request. A probe that throws is down.
 */
export function cachedProbe(probe: () => Promise<Probe>, opts: { ttlMs?: number; now?: () => number } = {}): () => Promise<Probe> {
  const ttl = opts.ttlMs ?? PROBE_CACHE_MS;
  const now = opts.now ?? Date.now;
  let last: { at: number; result: Probe } | null = null;
  let pending: Promise<Probe> | null = null;
  return () => {
    if (last && now() - last.at < ttl) return Promise.resolve(last.result);
    pending ??= probe()
      .catch((): Probe => ({ ok: false, err: 'OpenAI failed' }))
      .then((result) => {
        last = { at: now(), result };
        pending = null;
        return result;
      });
    return pending;
  };
}

/**
 * Whether her last `FALLBACK_STREAK` calls whose part has ended all ended with
 * the fallback, the latest started within `pauseMinutes`. A call the lead hung
 * up on before she ended it has no `ai_ended_with`, and neither breaks nor
 * adds to the streak.
 */
export async function fallbackStreak(q: Db, pauseMinutes: number): Promise<boolean> {
  const { rows } = await q.query(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE ai_ended_with = 'fallback')::int AS fallbacks,
            COALESCE(max(ai_started_at) > now() - make_interval(mins => $2), false) AS recent
     FROM (
       SELECT ai_ended_with, ai_started_at FROM calls
       WHERE ai_ended_with IS NOT NULL
       ORDER BY ai_started_at DESC, id DESC
       LIMIT $1
     ) last`,
    [FALLBACK_STREAK, pauseMinutes]
  );
  const r = rows[0];
  return r.n === FALLBACK_STREAK && r.fallbacks === FALLBACK_STREAK && r.recent;
}

/**
 * Seri's state for the robot, in order: off - nothing else asked; paused
 * after three fallbacks - OpenAI not asked meanwhile; then OpenAI.
 */
export function seriState(deps: {
  on: () => Promise<boolean>;
  paused: () => Promise<boolean>;
  probe: () => Promise<Probe>;
}): () => Promise<SeriState> {
  return async () => {
    if (!(await deps.on())) return { state: 'off' };
    if (await deps.paused()) return { state: 'fallbacks' };
    const probe = await deps.probe();
    return probe.ok ? { state: 'ready' } : { state: 'openai_down', err: probe.err };
  };
}
