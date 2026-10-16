/**
 * Sends the first question to leads an EZ Texting outage left without one -
 * worker/send-waiting-openers.ts. POLLER.md, "Resending after an outage", has
 * when and how to run it; core/resend-args.ts the arguments.
 *
 *   docker compose exec worker npm run openers:send-waiting -- --from 2026-10-14 --dry-run
 *   (locally, without a build: npm run dev:openers:send-waiting -- ...)
 *
 * Ctrl+C is safe: a text being sent when it stops is recorded as possibly
 * sent and never sent again, and the run's lock goes with the connection.
 *
 * Exits 0 when it finished, or after a dry run; 1 when it was refused, stopped
 * at a text that did not go out, or another run was going.
 */
import '../config';
import { parseResendArgs, USAGE } from '../core/resend-args';
import { pool } from '../db/pool';
import { resendWaitingOpeners } from '../worker/send-waiting-openers';

async function main(): Promise<number> {
  const parsed = parseResendArgs(process.argv.slice(2), new Date());
  if (!parsed.ok) {
    if ('help' in parsed) {
      console.log(USAGE);
      return 0;
    }
    console.error(`${parsed.error}\n\n${USAGE}`);
    return 1;
  }

  const report = await resendWaitingOpeners(parsed.options, {
    print: (line) => console.log(line),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  });
  return report.busy || report.stoppedAt ? 1 : 0;
}

main()
  .then((code) => pool.end().then(() => process.exit(code)))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    pool.end().finally(() => process.exit(1));
  });
