/**
 * Whether an answered automated call goes to Seri, and what she opens with -
 * A13, docs/AI-AGENT.md section 2.
 *
 * `/auto/answer` asks this when the lead picks up. On - the switch on and a
 * key to reach OpenAI with (settings.ts) - the call is connected to her relay
 * (`seriTwiml`, integrations/twilio.ts), and Twilio says her greeting the
 * moment it connects, with no wait on OpenAI. Off: today's script, as before.
 * Read on every call, so switching her on or off changes the next call and no
 * call already going.
 */

import type { Db } from '../db/flows';
import { welcomeGreeting } from './instructions';
import { readAiAgentOn } from './settings';

/**
 * Her greeting for this call - "Hi, is this John?", or "Hi there!" with no
 * name - when the call goes to her; null when it goes to the script. The relay
 * builds the same greeting from the same name, as her first turn.
 */
export async function seriGreeting(q: Db, callId: number, apiKey: string): Promise<string | null> {
  if (!(await readAiAgentOn(q, apiKey))) return null;
  const { rows } = await q.query(
    `SELECT l.first_name AS "firstName" FROM calls c JOIN leads l ON l.id = c.lead_id WHERE c.id = $1`,
    [callId]
  );
  return welcomeGreeting(rows[0]?.firstName ?? null);
}
