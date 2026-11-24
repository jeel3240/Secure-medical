/**
 * Whether Seri, the AI agent, runs the automated call - docs/AI-AGENT.md,
 * section 7.
 *
 * The switch is `settings.ai_agent`, changed only by the server command
 * (`cli/ai-agent.ts`, through `switchAiAgent` below) - production's database is
 * never edited by hand (WORKFLOW.md). It is read on every call, so the next
 * call follows it with no restart, and a call already talking to Seri goes on.
 *
 * Seri also needs `OPENAI_API_KEY`: on without a key is off.
 */

import type { Pool } from 'pg';
import { recordActivity } from '../db/activity';
import type { Db } from '../db/flows';
import { log } from '../lib/log';

export type AiAgentSwitch = 'on' | 'off';

/**
 * The switch as stored. On only when it says exactly `on`: a typo is never a
 * yes, as with `AUTO_CALLS` (auto-calls-settings.ts). Missing is off.
 */
export function parseAiAgentSwitch(raw: string | null | undefined): AiAgentSwitch {
  return raw === 'on' ? 'on' : 'off';
}

/** `settings.ai_agent`, read now. */
export async function readAiAgentSwitch(q: Db): Promise<AiAgentSwitch> {
  const { rows } = await q.query(`SELECT value FROM settings WHERE key = 'ai_agent'`);
  return parseAiAgentSwitch(rows[0]?.value);
}

let noKeyLogged = false;

/**
 * Whether the next call goes to Seri: the switch on, and a key to reach OpenAI
 * with. On without a key - taken out of `.env` after switching on - is off:
 * the call gets today's script, and the first such call logs
 * `ai_agent.no_key`, once per process.
 *
 * Never a reason to refuse to start, unlike a half-set Twilio group
 * (api/startup-checks.ts): the switch changes while the API runs, so a startup
 * check would only see it at the next restart, and would take down the queue,
 * the texts and every screen for something whose fallback is today's script.
 */
export async function readAiAgentOn(q: Db, apiKey: string): Promise<boolean> {
  if ((await readAiAgentSwitch(q)) === 'off') return false;
  if (apiKey.trim() !== '') return true;
  if (!noKeyLogged) {
    noKeyLogged = true;
    log.warn('ai_agent.no_key');
  }
  return false;
}

/** The command's one argument, `on` or `off`. Null for anything else: the usage is printed. */
export function parseSwitchArgs(args: readonly string[]): AiAgentSwitch | null {
  if (args.length !== 1) return null;
  return args[0] === 'on' || args[0] === 'off' ? args[0] : null;
}

/** Why the switch must not be made: on without a key would only send every call to the script. */
export function switchRefusal(to: AiAgentSwitch, apiKey: string): 'no_key' | null {
  return to === 'on' && apiKey.trim() === '' ? 'no_key' : null;
}

export interface SwitchResult {
  /** What the row said before - null when there was none. */
  from: string | null;
  to: AiAgentSwitch;
  /** False when it already said so: nothing written, nothing recorded. */
  changed: boolean;
}

/**
 * Sets the switch, and records the change in the activity log in the same
 * transaction - `ai_agent.switched` (docs/AUDIT.md): the row is overwritten, so
 * the log keeps what it said before. Setting it to what it already says writes
 * nothing. One switch at a time, row or no row, as `recordAutoCallsSwitch`
 * does.
 *
 * Run by someone on the server, who is no user of the app: the record's actor
 * is null, and `via` says it was the command.
 */
export async function switchAiAgent(pool: Pool, to: AiAgentSwitch): Promise<SwitchResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('ai_agent_switch'))`);
    const { rows } = await client.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'ai_agent'`);
    const from = rows[0]?.value ?? null;
    if (from === to) {
      await client.query('COMMIT');
      return { from, to, changed: false };
    }
    await client.query(
      `INSERT INTO settings (key, value) VALUES ('ai_agent', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [to]
    );
    await recordActivity(client, {
      action: 'ai_agent.switched',
      actorId: null,
      detail: { from, to, via: 'command' },
    });
    await client.query('COMMIT');
    return { from, to, changed: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
