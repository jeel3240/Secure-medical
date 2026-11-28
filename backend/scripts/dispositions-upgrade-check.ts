/**
 * Proves migration 025 (B04) over outcomes in 024's shape: every existing
 * disposition gets the conversation its lead had when it was saved, and no
 * reason, and nothing else changes; and the migration stops, changing nothing,
 * when an outcome on a lead with a conversation would get none. The pattern:
 * docs/TESTING.md, "Upgrade checks".
 *
 * It migrates the database itself, so it refuses one that has been migrated:
 *
 *   scripts/live-checks.sh dispositions-upgrade-check
 */
import { check, failureCount, verdict } from './check';
import { asBefore, migrateTo, refuseUnlessEmpty, rowsOf } from './upgrade';
import { pool } from '../src/db/pool';

const id = async (sql: string, values: unknown[] = []): Promise<number> =>
  (await pool.query<{ id: number }>(sql, values)).rows[0].id;

async function main() {
  await refuseUnlessEmpty();

  console.log('to 024');
  check('migrated to 024, and stopped there', migrateTo('024'), 'applied 24 migration(s) up to 024');

  // 024's shape, by hand: dispositions are lead, agent, value and when.
  const nora = await id(`INSERT INTO users (email, password_hash, name, role) VALUES ('nora@example.com', 'x', 'Nora', 'agent') RETURNING id`);
  const lead = (first: string, phone: string) =>
    id(`INSERT INTO leads (phone, first_name, source) VALUES ($1, $2, 'CORE-G-27') RETURNING id`, [phone, first]);
  const conversation = (leadId: number, daysAgo: number) =>
    id(
      `INSERT INTO conversations (lead_id, status, step, score, tier, flow_id, created_at)
       VALUES ($1, 'completed', NULL, 60, 'WARM', (SELECT id FROM flows WHERE is_active), now() - ($2 || ' days')::interval) RETURNING id`,
      [leadId, String(daysAgo)]
    );
  const outcome = (leadId: number, value: string, daysAgo: number) =>
    id(
      `INSERT INTO dispositions (lead_id, agent_id, value, created_at) VALUES ($1, $2, $3, now() - ($4 || ' days')::interval) RETURNING id`,
      [leadId, nora, value, String(daysAgo)]
    );

  const maya = await lead('Maya', '+15555550111');
  const mayaConversation = await conversation(maya, 10);
  const closed = await outcome(maya, 'closed', 9);
  const dnc = await outcome(maya, 'dnc', 8);

  // The retired values, from before 2026-09-28.
  const priya = await lead('Priya', '+15555550112');
  const priyaConversation = await conversation(priya, 90);
  const retired: Record<string, number> = {};
  for (const [i, value] of ['sold', 'interested', 'callback_set', 'no_answer', 'voicemail', 'not_interested', 'wrong_number'].entries()) {
    retired[value] = await outcome(priya, value, 80 - i);
  }

  // Two conversations: each outcome gets the one that was newest when it was saved.
  const dana = await lead('Dana', '+15555550113');
  const first = await conversation(dana, 30);
  const beforeSecond = await outcome(dana, 'closed', 20);
  const second = await conversation(dana, 5);
  const afterSecond = await outcome(dana, 'closed', 1);

  // Same moment twice: the higher id is the newer, as newestConversation says.
  const leo = await lead('Leo', '+15555550114');
  const tiedLow = await conversation(leo, 3);
  const tiedHigh = await id(
    `INSERT INTO conversations (lead_id, status, step, score, tier, flow_id, created_at)
     SELECT lead_id, 'expired', 1, 0, NULL, flow_id, created_at FROM conversations WHERE id = $1 RETURNING id`,
    [tiedLow]
  );
  const onTie = await outcome(leo, 'closed', 1);

  // No conversation at all: nothing to name, and nothing stops.
  const bare = await lead('Bare', '+15555550115');
  const onBare = await outcome(bare, 'closed', 1);

  console.log('\nan outcome older than every conversation of its lead');
  const odd = await lead('Odd', '+15555550116');
  const oddOutcome = await outcome(odd, 'closed', 10);
  await conversation(odd, 2);
  let stopped = '';
  try {
    migrateTo('025');
  } catch (err) {
    stopped = (err as Error).message;
  }
  check('025 stops', /1 outcome\(s\) on a lead with a conversation found no conversation/.test(stopped), true);
  check('and changes nothing: 025 is not recorded, the columns are not there',
    (await pool.query(
      `SELECT (SELECT count(*)::int FROM schema_migrations WHERE name LIKE '025_%') AS recorded,
              (SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'dispositions' AND column_name IN ('reason', 'conversation_id')) AS columns`
    )).rows[0],
    { recorded: 0, columns: 0 });
  // The seed's own odd row goes; the rest is what a real database holds.
  await pool.query(`DELETE FROM dispositions WHERE id = $1`, [oddOutcome]);

  const before = await rowsOf('dispositions');

  console.log('\n025, over the rest');
  check('025 applied', migrateTo('025'), 'applied 1 migration(s) up to 025');
  const after = await rowsOf('dispositions');
  check('every outcome as it was - lead, agent, value, when', asBefore(before, after), before);
  check('none has a reason: nobody was asked', after.filter((r) => r.reason !== null).length, 0);

  const conversationOf = Object.fromEntries(after.map((r) => [r.id as number, r.conversation_id]));
  check('Closed and DNC: the lead\'s one conversation', [conversationOf[closed], conversationOf[dnc]], [mayaConversation, mayaConversation]);
  check('every retired value: the conversation it was saved on',
    Object.values(retired).map((d) => conversationOf[d]), Object.values(retired).map(() => priyaConversation));
  check('two conversations: the outcome before the second has the first, the one after has the second',
    [conversationOf[beforeSecond], conversationOf[afterSecond]], [first, second]);
  check('two started at the same moment: the higher id', conversationOf[onTie], Math.max(tiedLow, tiedHigh));
  check('a lead with no conversation: none', conversationOf[onBare], null);

  console.log('\nthe rest, over the same rows');
  migrateTo();
  check('every outcome still names its conversation', (await rowsOf('dispositions')).map((r) => r.conversation_id), after.map((r) => r.conversation_id));

  console.log(verdict());
  await pool.end();
  process.exit(failureCount() === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
