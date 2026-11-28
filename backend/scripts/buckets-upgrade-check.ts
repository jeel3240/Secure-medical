/**
 * Proves migration 026 (B07) over a database in 025's shape: the antibiotics
 * bucket is made, every flow and call script lands in it - the retired wellness
 * flow too - no conversation is touched, and `conversations.flow_id` becomes
 * required; and the migration stops, changing nothing, when a conversation has
 * no flow. The pattern: docs/TESTING.md, "Upgrade checks".
 *
 * It migrates the database itself, so it refuses one that has been migrated:
 *
 *   scripts/live-checks.sh buckets-upgrade-check
 */
import { check, failureCount, verdict } from './check';
import { asBefore, migrateTo, refuseUnlessEmpty, rowsOf } from './upgrade';
import { pool } from '../src/db/pool';

const id = async (sql: string, values: unknown[] = []): Promise<number> =>
  (await pool.query<{ id: number }>(sql, values)).rows[0].id;

/** Whether a column may be null, as the database says - 'YES' or 'NO'. */
const nullable = async (table: string, column: string): Promise<string> =>
  (
    await pool.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column]
    )
  ).rows[0]?.is_nullable ?? 'no such column';

async function main() {
  await refuseUnlessEmpty();

  console.log('to 025');
  check('migrated to 025, and stopped there', migrateTo('025'), 'applied 25 migration(s) up to 025');

  // 025's shape, by hand: a conversation names its flow, a flow and a script name nothing else.
  const lead = (first: string, phone: string) =>
    id(`INSERT INTO leads (phone, first_name, source) VALUES ($1, $2, 'CORE-G-27') RETURNING id`, [phone, first]);
  const flowId = (key: string) => id(`SELECT id FROM flows WHERE key = $1`, [key]);
  const firstQuestion = (key: string) =>
    id(`SELECT q.id FROM flow_questions q JOIN flows f ON f.id = q.flow_id WHERE f.key = $1 ORDER BY q.position LIMIT 1`, [key]);

  // From before 2026-10-05: finished, on the retired wellness flow.
  const old = await lead('Maya', '+15555550121');
  await pool.query(
    `INSERT INTO conversations (lead_id, flow_id, status, step, q1, q2, q3, score, tier, completed_at, created_at)
     VALUES ($1, $2, 'completed', 3, '1', '2', '1', 80, 'HOT', now() - interval '70 days', now() - interval '71 days')`,
    [old, await flowId('wellness')]
  );
  // On antibiotics: one finished, one still answering.
  const done = await lead('Priya', '+15555550122');
  await pool.query(
    `INSERT INTO conversations (lead_id, flow_id, status, step, score, tier, end_outcome, completed_at)
     VALUES ($1, $2, 'completed', NULL, 55, 'WARM', 'completed', now() - interval '1 day')`,
    [done, await flowId('antibiotics')]
  );
  const open = await lead('Dana', '+15555550123');
  await pool.query(
    `INSERT INTO conversations (lead_id, flow_id, status, step, current_question_id, question_sent_at, score)
     VALUES ($1, $2, 'open', 10, $3, now() - interval '5 minutes', 0)`,
    [open, await flowId('antibiotics'), await firstQuestion('antibiotics')]
  );

  console.log('\na conversation in no flow');
  const odd = await lead('Odd', '+15555550124');
  const oddConversation = await id(`INSERT INTO conversations (lead_id, status, step, score) VALUES ($1, 'expired', 1, 0) RETURNING id`, [odd]);
  let stopped = '';
  try {
    migrateTo('026');
  } catch (err) {
    stopped = (err as Error).message;
  }
  check('026 stops, and says how many', /conversations: 1 have no flow_id/.test(stopped), true);
  check(
    'and changes nothing: 026 is not recorded, there is no buckets table, no bucket_id, flow_id still optional',
    (
      await pool.query(
        `SELECT (SELECT count(*)::int FROM schema_migrations WHERE name LIKE '026_%') AS recorded,
                to_regclass('public.buckets') IS NOT NULL AS buckets,
                (SELECT count(*)::int FROM information_schema.columns
                 WHERE table_schema = 'public' AND column_name = 'bucket_id' AND table_name IN ('flows', 'call_scripts')) AS columns`
      )
    ).rows[0],
    { recorded: 0, buckets: false, columns: 0 }
  );
  check('flow_id still optional', await nullable('conversations', 'flow_id'), 'YES');
  // The seed's own odd row goes; the rest is what a real database holds.
  await pool.query(`DELETE FROM conversations WHERE id = $1`, [oddConversation]);

  const before = {
    conversations: await rowsOf('conversations'),
    flows: await rowsOf('flows'),
    callScripts: await rowsOf('call_scripts'),
  };

  console.log('\n026, over the rest');
  check('026 applied', migrateTo('026'), 'applied 1 migration(s) up to 026');
  check('one bucket, antibiotics', (await pool.query(`SELECT key, name FROM buckets ORDER BY id`)).rows, [
    { key: 'antibiotics', name: 'Antibiotics' },
  ]);
  check(
    'every flow is in it - the retired wellness flow too',
    (await pool.query(`SELECT f.key, b.key AS bucket FROM flows f JOIN buckets b ON b.id = f.bucket_id ORDER BY f.id`)).rows,
    [
      { key: 'wellness', bucket: 'antibiotics' },
      { key: 'antibiotics', bucket: 'antibiotics' },
    ]
  );
  check(
    'and every call script',
    (await pool.query(`SELECT s.key, b.key AS bucket FROM call_scripts s JOIN buckets b ON b.id = s.bucket_id ORDER BY s.id`)).rows,
    [{ key: 'antibiotics', bucket: 'antibiotics' }]
  );
  const after = {
    conversations: await rowsOf('conversations'),
    flows: await rowsOf('flows'),
    callScripts: await rowsOf('call_scripts'),
  };
  check('no conversation is touched', after.conversations, before.conversations);
  check('every flow as it was, apart from its bucket', asBefore(before.flows, after.flows), before.flows);
  check('every call script as it was, apart from its bucket', asBefore(before.callScripts, after.callScripts), before.callScripts);
  check(
    'flow_id, and each bucket_id, required',
    [await nullable('conversations', 'flow_id'), await nullable('flows', 'bucket_id'), await nullable('call_scripts', 'bucket_id')],
    ['NO', 'NO', 'NO']
  );

  console.log('\nthe rest, over the same rows');
  migrateTo();
  check(
    'every flow and script still in its bucket',
    (await pool.query(`SELECT (SELECT array_agg(bucket_id ORDER BY id) FROM flows) AS flows, (SELECT array_agg(bucket_id ORDER BY id) FROM call_scripts) AS scripts`)).rows[0],
    { flows: after.flows.map((r) => r.bucket_id), scripts: after.callScripts.map((r) => r.bucket_id) }
  );

  console.log(verdict());
  await pool.end();
  process.exit(failureCount() === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
