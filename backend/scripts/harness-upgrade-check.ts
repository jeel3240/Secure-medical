/**
 * Proves the upgrade-check harness (B03) on migrations that exist: an empty
 * database migrated to 021, rows seeded in 021's shape with plain SQL, then
 * 022-024 run over them - every row must come through as it was, and the
 * columns and rows those three add must be what they say. Then everything
 * after 024, so a later migration that cannot run over existing rows fails
 * here too. The pattern for every upgrade check: docs/TESTING.md, "Upgrade
 * checks"; the helpers are `scripts/upgrade.ts`.
 *
 * It migrates the database itself, so it refuses one that has been migrated.
 * Through the runner, which makes an empty one and leaves the migrating to it:
 *
 *   scripts/live-checks.sh harness-upgrade-check
 *
 * By hand:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE upgrade_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/upgrade_check JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/harness-upgrade-check.ts
 */
import fs from 'fs';
import path from 'path';
import { check, failureCount, verdict } from './check';
import { asBefore, hasColumn, migrateTo, refuseUnlessEmpty, rowsOf } from './upgrade';
import { pool } from '../src/db/pool';

const TABLES = ['users', 'leads', 'conversations', 'calls', 'callbacks', 'dispositions'] as const;

const one = async (sql: string, values: unknown[] = []): Promise<number> =>
  (await pool.query<{ id: number }>(sql, values)).rows[0].id;

const settingsNow = async () =>
  (await pool.query<{ key: string; value: string }>(`SELECT key, value FROM settings ORDER BY key`)).rows;

async function main() {
  await refuseUnlessEmpty();

  console.log('to 021');
  check('migrated to 021, and stopped there', migrateTo('021'), 'applied 21 migration(s) up to 021');
  check('022 has not run: calls has no ai_started_at', await hasColumn('calls', 'ai_started_at'), false);

  // 021's shape, by hand: nothing here goes through src/db/.
  const nora = await one(`INSERT INTO users (email, password_hash, name, role) VALUES ('nora@example.com', 'x', 'Nora', 'agent') RETURNING id`);
  const maya = await one(
    `INSERT INTO leads (phone, first_name, last_name, source, ezt_added_at, assigned_to, assigned_at)
     VALUES ('+15555550101', 'Maya', 'Chen', 'CORE-G-27', now() - interval '3 days', $1, now()) RETURNING id`,
    [nora]
  );
  await one(
    `INSERT INTO conversations (lead_id, status, step, score, tier, flow_id, completed_at, end_outcome)
     VALUES ($1, 'completed', NULL, 85, 'HOT', (SELECT id FROM flows WHERE is_active), now() - interval '3 days', 'completed') RETURNING id`,
    [maya]
  );
  await one(
    `INSERT INTO calls (lead_id, direction, twilio_call_sid, answered_by, script_result, started_at, ended_at, duration_sec)
     VALUES ($1, 'automated', 'CA-upgrade-1', 'human', 'transfer_missed', now() - interval '2 days', now() - interval '2 days' + interval '40 seconds', 40) RETURNING id`,
    [maya]
  );
  await one(
    `INSERT INTO calls (lead_id, agent_id, direction, twilio_call_sid, outcome, duration_sec)
     VALUES ($1, $2, 'outbound', 'CA-upgrade-2', 'answered', 120) RETURNING id`,
    [maya, nora]
  );
  await one(`INSERT INTO callbacks (lead_id, agent_id, scheduled_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id`, [maya, nora]);
  await one(`INSERT INTO dispositions (lead_id, agent_id, value) VALUES ($1, $2, 'closed') RETURNING id`, [maya, nora]);

  const before = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await rowsOf(t)] as const)));
  const settingsBefore = await settingsNow();

  console.log('\n022 to 024, over those rows');
  check('022 to 024 applied', migrateTo('024'), 'applied 3 migration(s) up to 024');
  for (const table of TABLES) {
    check(`${table}: every row as it was`, asBefore(before[table], await rowsOf(table)), before[table]);
  }
  check(
    '022: both calls without Seri - started, version and ending all empty',
    (await pool.query(`SELECT ai_started_at, ai_knowledge_version, ai_ended_with FROM calls ORDER BY id`)).rows,
    [
      { ai_started_at: null, ai_knowledge_version: null, ai_ended_with: null },
      { ai_started_at: null, ai_knowledge_version: null, ai_ended_with: null },
    ]
  );
  check(
    "022, 023: the call back is an agent's - no call of Seri's behind it, no note",
    (await pool.query(`SELECT reason, booked_by_call_id, note FROM callbacks`)).rows,
    [{ reason: 'booked', booked_by_call_id: null, note: null }]
  );
  check(
    "022: Seri's switch added, off; every other setting as it was",
    await settingsNow(),
    [...settingsBefore, { key: 'ai_agent', value: 'off' }].sort((a, b) => a.key.localeCompare(b.key))
  );
  check("022: Seri's turns table there, and empty", (await pool.query(`SELECT count(*)::int AS n FROM call_ai_turns`)).rows[0].n, 0);
  check('024: her turns have a data column', await hasColumn('call_ai_turns', 'data'), true);

  console.log('\nthe rest, over the same rows');
  migrateTo();
  const files = fs.readdirSync(path.join(__dirname, '..', 'src', 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  check(
    'every migration in the folder ran over 021-shaped rows',
    (await pool.query<{ name: string }>(`SELECT name FROM schema_migrations ORDER BY name`)).rows.map((r) => r.name),
    files
  );

  console.log(verdict());
  await pool.end();
  process.exit(failureCount() === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
