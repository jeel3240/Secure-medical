/**
 * Has the robot also call the leads that were already waiting for a reply
 * when automated calls were switched on - AUTO-CALLS.md, "Leads already
 * waiting". New leads keep their call an hour after the text; these fill the
 * room left, oldest first. Only while automated calls are on, and for that
 * switch-on alone: the next one starts afresh.
 *
 *   docker compose exec worker npm run auto-calls:include-waiting -- --dry-run
 *   (locally, without a build: npm run dev:auto-calls:include-waiting -- ...)
 *
 * Exits 0 when it did what was asked, or nothing needed doing; 1 when it was
 * refused.
 */
import '../config';
import { readAutoCallTestNumbers } from '../auto-calls-settings';
import { arizonaTime } from '../core/resend-args';
import { autoCallsState, leadsToCall, setWaitingIncluded } from '../db/auto-dial';
import { readCallHours } from '../db/call-script';
import { pool } from '../db/pool';

const USAGE = `Usage: npm run auto-calls:include-waiting -- [--dry-run | --stop]

  (nothing)   the robot also calls the leads that were already waiting for a
              reply when automated calls were switched on - after new leads,
              in the time it has to spare
  --dry-run   lists those leads, changes nothing
  --stop      stops calling them; new leads go on as before`;

type Mode = 'include' | 'dry-run' | 'stop';

function parse(args: string[]): Mode | 'help' | { error: string } {
  if (args.includes('--help') || args.includes('-h')) return 'help';
  const unknown = args.find((a) => a !== '--dry-run' && a !== '--stop');
  if (unknown) return { error: `Unknown argument: ${unknown}` };
  if (args.includes('--dry-run') && args.includes('--stop')) return { error: '--dry-run and --stop cannot go together.' };
  return args.includes('--stop') ? 'stop' : args.includes('--dry-run') ? 'dry-run' : 'include';
}

async function main(): Promise<number> {
  const mode = parse(process.argv.slice(2));
  if (mode === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (typeof mode === 'object') {
    console.error(`${mode.error}\n\n${USAGE}`);
    return 1;
  }

  const state = await autoCallsState();
  if (!state.on || state.since === null) {
    console.error('Automated calls are off. Switch them on first (docs/AUTO-CALLS.md, "Going live"), then run this.');
    return 1;
  }
  console.log(`Automated calls were switched on ${arizonaTime(state.since)}, Arizona time.`);
  console.log(`Leads already waiting then: ${state.waitingIncluded ? 'being called' : 'not called'}.`);
  console.log('');

  if (mode === 'stop') {
    const change = await setWaitingIncluded(false, 0);
    if (change.kind === 'off') {
      console.error('Automated calls were switched off meanwhile. Nothing changed.');
      return 1;
    }
    console.log(
      change.kind === 'changed'
        ? 'Stopped: the robot no longer calls them. New leads go on as before.'
        : 'They were not being called. Nothing changed.'
    );
    return 0;
  }

  const hours = await readCallHours(pool);
  const production = process.env.NODE_ENV === 'production';
  const only = readAutoCallTestNumbers(process.env, production).only;
  const ids = await leadsToCall({
    now: new Date(),
    since: state.since,
    waitMinutes: hours.waitMinutes,
    only: only === null ? null : [...only],
    limit: 100_000,
    waiting: 'only',
  });
  const { rows } = await pool.query<{ id: number; first_name: string | null; phone: string; created_at: Date }>(
    `SELECT id, first_name, phone, created_at FROM leads WHERE id = ANY($1)`,
    [ids]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const where = production ? '' : ' (outside production: the test numbers only)';
  if (ids.length === 0) {
    console.log(`No lead from before the switch-on is due a call now${where}.`);
  } else {
    console.log(`${ids.length} from before the switch-on due a call now${where}, in the order they would be called:`);
    for (const id of ids) {
      const lead = byId.get(id);
      if (lead) console.log(`  #${id} ${lead.first_name ?? '-'} ··${lead.phone.slice(-4)}  arrived ${arizonaTime(lead.created_at)}`);
    }
  }
  console.log('');

  if (mode === 'dry-run') {
    console.log('Dry run: nothing changed.');
    return 0;
  }
  const change = await setWaitingIncluded(true, ids.length);
  if (change.kind === 'off') {
    console.error('Automated calls were switched off meanwhile. Nothing changed.');
    return 1;
  }
  console.log(
    change.kind === 'changed'
      ? 'Done: the robot calls these too, inside the calling hours - after new leads, in the time it has to spare.'
      : 'They are already being called. Nothing changed.'
  );
  return 0;
}

main()
  .then((code) => pool.end().then(() => process.exit(code)))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    pool.end().finally(() => process.exit(1));
  });
