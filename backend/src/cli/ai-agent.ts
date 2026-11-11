/**
 * Switches Seri, the AI agent, on or off - docs/AI-AGENT.md, section 7.
 *
 *   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api npm run ai-agent -- on
 *   (locally: docker compose exec api npm run dev:ai-agent -- on)
 *
 * The switch is read on every call, so the next call follows it with no
 * restart, and a call already with Seri goes on. Each change is one row in the
 * activity log. `on` is refused without OPENAI_API_KEY, and nothing is
 * written. This command is the only way the switch changes: production's
 * database is never edited by hand (WORKFLOW.md).
 */
import { config } from '../config';
import { parseSwitchArgs, switchAiAgent, switchRefusal } from '../ai/settings';
import { readAutoCalls } from '../auto-calls-settings';
import { pool } from '../db/pool';

async function main(): Promise<number> {
  const to = parseSwitchArgs(process.argv.slice(2));
  if (!to) {
    console.error('Usage: npm run ai-agent -- on|off');
    return 1;
  }
  if (switchRefusal(to, config.openai.apiKey) === 'no_key') {
    console.error('Refused: OPENAI_API_KEY is not set. Put it in .env and recreate the api and the worker first. Nothing was changed.');
    return 1;
  }

  const result = await switchAiAgent(pool, to);
  if (!result.changed) {
    console.log(`The AI agent is already ${to}. Nothing was changed.`);
  } else {
    const was = result.from ?? 'never set, so off';
    const next = to === 'on' ? 'The next automated call goes to Seri.' : 'The next automated call uses the script.';
    console.log(`The AI agent is now ${to} (it was ${was}). ${next}`);
  }
  if (!readAutoCalls(process.env).on) {
    console.log('Automated calls are off here (AUTO_CALLS), so no call is placed either way.');
  }
  return 0;
}

main()
  .then((code) => pool.end().then(() => process.exit(code)))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    pool.end().finally(() => process.exit(1));
  });
