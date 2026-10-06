/**
 * How long each screen's read takes with a lot of leads - the number behind
 * "How fast it is" in docs/QUEUE.md and docs/ADMIN-LEADS.md.
 *
 * Loads fake leads into an empty scratch database - with their conversations,
 * answers, messages, calls, notes, callbacks and outcomes, in the proportions
 * a year or two of real use would leave - then times the function behind each
 * screen, and the reply path, the way the API calls them.
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE speed'
 *   DATABASE_URL=postgres://app:app@localhost:5433/speed node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/speed JWT_SECRET=x EZT_USERNAME=x \
 *     EZT_PASSWORD=x EZT_GROUP=weightloss EZT_SEND_GROUP=weightloss npm run speed -- 50000
 *
 * It writes rows, so it refuses a database that already holds leads. Nothing
 * is sent anywhere. The numbers depend on the machine: compare runs on the
 * same one, before and after a change.
 */
import { applyReply } from '../src/api/reply-flow';
import { getAdminConfig } from '../src/db/admin-config';
import { getOverview } from '../src/db/admin-overview';
import { listCallbacks } from '../src/db/callbacks';
import { getLeadDetail } from '../src/db/lead-detail';
import { listAdminLeads } from '../src/db/leads';
import { pool } from '../src/db/pool';
import { listQueue } from '../src/db/queue';
import { getTimeline } from '../src/db/timeline';

const LEADS = Math.max(1000, Number(process.argv[2]) || 50_000);

/**
 * `kind` (0-100) decides how far a lead got: 0-29 never answered, 30-39
 * partway, 40-74 finished, 75-82 offers only, 83-87 asked for a rep, 88-94
 * expired, 95-97 needs review, 98-100 blocked on arrival. Most finished leads
 * older than three days have been closed, as they would be.
 */
async function load(): Promise<void> {
  const q = (sql: string) => pool.query(sql);
  const flow = `(SELECT id FROM flows WHERE key = 'antibiotics')`;
  const question = (key: string) =>
    `(SELECT fq.id FROM flow_questions fq JOIN flows f ON f.id = fq.flow_id WHERE f.key = 'antibiotics' AND fq.key = '${key}')`;

  await q(`INSERT INTO users (email, password_hash, name, role)
           SELECT 'agent' || g || '@example.com', 'x', 'Agent ' || g, CASE WHEN g = 1 THEN 'superadmin' ELSE 'agent' END
           FROM generate_series(1, 10) g`);
  await q(`CREATE TABLE speed_plan AS
           SELECT g AS n, now() - (random() * interval '540 days') AS at, (random() * 100)::int AS kind
           FROM generate_series(1, ${LEADS}) g`);
  await q(`INSERT INTO leads (id, phone, first_name, last_name, source, group_name, ezt_added_at, created_at)
           SELECT n, '+1555' || lpad(n::text, 7, '0'), 'Lead' || n, 'Test', 'API', 'weightloss', at, at FROM speed_plan`);
  await q(`SELECT setval('leads_id_seq', ${LEADS})`);
  await q(`INSERT INTO conversations (id, lead_id, status, step, flow_id, current_question_id, end_outcome, score, tier,
                                      invalid_count, expires_at, completed_at, created_at, updated_at)
           SELECT n, n,
             CASE WHEN kind < 40 THEN (CASE WHEN at < now() - interval '7 days' THEN 'expired' ELSE 'open' END)
                  WHEN kind < 88 THEN 'completed' WHEN kind < 95 THEN 'expired' WHEN kind < 98 THEN 'review' ELSE 'suppressed' END,
             CASE WHEN kind < 30 THEN 10 WHEN kind < 40 THEN 20 WHEN kind < 88 THEN NULL WHEN kind < 98 THEN 10 END,
             ${flow},
             CASE WHEN kind < 30 THEN ${question('q1')} WHEN kind < 40 THEN ${question('q2')}
                  WHEN kind >= 88 AND kind < 98 THEN ${question('q1')} END,
             CASE WHEN kind >= 40 AND kind < 75 THEN 'completed' WHEN kind >= 75 AND kind < 83 THEN 'offers'
                  WHEN kind >= 83 AND kind < 88 THEN 'wants_contact' END,
             CASE WHEN kind < 30 THEN 0 WHEN kind < 40 THEN 30 WHEN kind < 75 THEN 55 + (n % 46) WHEN kind < 88 THEN 10
                  WHEN kind < 95 THEN 0 WHEN kind < 98 THEN 10 ELSE 0 END,
             CASE WHEN kind >= 40 AND kind < 75 THEN (CASE WHEN 55 + (n % 46) >= 75 THEN 'HOT' ELSE 'WARM' END)
                  WHEN kind >= 30 AND kind < 88 THEN 'LOW' WHEN kind >= 95 AND kind < 98 THEN 'LOW' END,
             CASE WHEN kind >= 95 AND kind < 98 THEN 2 ELSE 0 END,
             at + interval '7 days',
             CASE WHEN kind >= 40 AND kind < 88 THEN at + interval '20 minutes' END,
             at, at + interval '20 minutes'
           FROM speed_plan`);
  await q(`SELECT setval('conversations_id_seq', ${LEADS})`);

  const answer = (key: string, position: number, heading: string, choice: string, label: string, points: string, where: string, after: string) =>
    q(`INSERT INTO conversation_answers (conversation_id, lead_id, question_id, question_key, position, heading, choice, label, points, created_at)
       SELECT n, n, ${question(key)}, '${key}', ${position}, '${heading}', ${choice}, ${label}, ${points}, at + interval '${after}'
       FROM speed_plan WHERE ${where}`);
  await answer('q1', 10, 'Requested info', `CASE WHEN kind < 75 THEN '1' ELSE '2' END`, `CASE WHEN kind < 75 THEN 'Yes' ELSE 'No' END`,
    `CASE WHEN kind < 75 THEN 20 ELSE 0 END`, 'kind >= 30 AND kind < 88', '5 minutes');
  await answer('q2', 20, 'Used telemedicine', `'1'`, `'Yes'`, '15', 'kind >= 40 AND kind < 75', '10 minutes');
  await answer('q3', 30, 'Next step', `'2'`, `'Talk to an agent'`, '45', 'kind >= 40 AND kind < 75', '20 minutes');
  await answer('q1-a', 11, 'Offers', `CASE WHEN kind < 83 THEN '1' ELSE '2' END`,
    `CASE WHEN kind < 83 THEN 'Special offers' ELSE 'Learn more' END`, '0', 'kind >= 75 AND kind < 88', '20 minutes');

  await q(`INSERT INTO messages (lead_id, direction, body, ezt_message_id, delivery_status, created_at)
           SELECT n, 'outbound', 'eDrugstore: Hi Lead, did you recently request more info about ordering antibiotics online? Reply 1. Yes, 2. No.', 'o' || n, NULL, at
           FROM speed_plan WHERE kind < 98`);
  await q(`INSERT INTO messages (lead_id, direction, body, from_number, received_at, created_at)
           SELECT a.lead_id, 'inbound', a.choice, '1555' || lpad(a.lead_id::text, 7, '0'), a.created_at, a.created_at FROM conversation_answers a`);
  await q(`INSERT INTO messages (lead_id, direction, body, ezt_message_id, delivery_status, created_at)
           SELECT a.lead_id, 'outbound', 'Great. The next question follows here for the lead to answer.', 'r' || a.id, NULL, a.created_at + interval '2 seconds'
           FROM conversation_answers a`);

  await q(`INSERT INTO dispositions (lead_id, agent_id, value, created_at)
           SELECT n, 1 + (n % 10), 'closed', at + interval '1 day' FROM speed_plan
           WHERE kind >= 40 AND kind < 88 AND kind NOT BETWEEN 75 AND 82 AND at < now() - interval '3 days' AND n % 20 <> 0`);
  await q(`INSERT INTO notes (lead_id, agent_id, body, created_at)
           SELECT n, 1 + (n % 10), 'Spoke to the lead, will call back.', at + interval '1 hour' FROM speed_plan
           WHERE kind >= 40 AND kind < 75 AND n % 2 = 0`);
  await q(`INSERT INTO calls (lead_id, agent_id, twilio_call_sid, started_at, ended_at, duration_sec, outcome, direction, created_at)
           SELECT n, 1 + (n % 10), 'CA' || n || '-' || k, at + interval '1 hour' * k, at + interval '1 hour' * k + interval '2 minutes', 120,
                  CASE WHEN k = 1 THEN 'no_answer' ELSE 'answered' END, 'outbound', at + interval '1 hour' * k
           FROM speed_plan, generate_series(1, 2) k WHERE kind >= 40 AND kind < 75`);
  await q(`INSERT INTO callbacks (lead_id, agent_id, scheduled_at, done_at, created_at)
           SELECT n, 1 + (n % 10), at + interval '2 days', CASE WHEN n % 3 = 0 THEN NULL ELSE at + interval '2 days' END, at + interval '1 hour'
           FROM speed_plan WHERE kind >= 40 AND kind < 75 AND n % 10 = 0`);
  await q(`UPDATE leads SET assigned_to = 1 + (id % 10), assigned_at = now() - interval '10 minutes' WHERE id % 500 = 0`);
  await q(`UPDATE leads SET has_unread_inbound = true WHERE id % 700 = 0`);
  await q(`DROP TABLE speed_plan`);
  await q(`ANALYZE`);
}

async function time(name: string, fn: () => Promise<unknown>, runs = 7): Promise<void> {
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = process.hrtime.bigint();
    await fn();
    ms.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  ms.sort((a, b) => a - b);
  const fmt = (n: number) => n.toFixed(1).padStart(8);
  console.log(`  ${name.padEnd(40)} median ${fmt(ms[Math.floor(runs / 2)])} ms   slowest ${fmt(ms[runs - 1])} ms`);
}

async function main(): Promise<void> {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM leads');
  if (rows[0].n > 0) {
    console.error(`Refusing: this database already holds ${rows[0].n} leads. Give it an empty one.`);
    process.exit(1);
  }

  console.log(`loading ${LEADS.toLocaleString()} leads...`);
  await load();
  const count = async (table: string) => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n.toLocaleString();
  console.log(
    `  ${await count('leads')} leads, ${await count('conversation_answers')} answers, ${await count('messages')} messages, ` +
      `${await count('calls')} calls, ${await count('dispositions')} outcomes`
  );

  const finished = (await pool.query(`SELECT lead_id FROM conversations WHERE end_outcome = 'completed' ORDER BY id DESC LIMIT 1`)).rows[0].lead_id;
  const partway = (await pool.query(`SELECT lead_id FROM conversations WHERE status = 'open' AND step = 20 ORDER BY id DESC LIMIT 1`)).rows[0]?.lead_id;

  console.log('\nthe queue - asked every five seconds by every agent');
  const queue = await listQueue();
  console.log(`  (${queue.total.toLocaleString()} leads in it)`);
  await time('as it opens', () => listQueue());
  await time('one tier', () => listQueue({ tier: ['HOT'] }));
  await time('a name search', () => listQueue({ q: 'Lead123' }));
  await time('the last 7 days', () => listQueue({ since: new Date(Date.now() - 7 * 864e5) }));

  console.log('\nAdmin > Leads');
  await time('every lead, first page', () => listAdminLeads({}));
  await time('one status', () => listAdminLeads({ status: 'ready' }));
  await time('a late page', () => listAdminLeads({ page: 400 }));
  await time('a name search', () => listAdminLeads({ q: 'Lead4999' }));

  console.log('\none lead');
  await time('the lead card', () => getLeadDetail(finished));
  await time('its timeline', () => getTimeline(finished));
  if (partway) {
    await time('a reply from the lead (not saved)', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await applyReply(client, partway, '+15550000000', 'Test', { text: 'yes', optOut: false });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  }

  console.log('\nthe rest');
  await time('My Callbacks, today', () => listCallbacks({ agentId: 3, when: 'today', timeZone: 'America/Phoenix' }));
  await time('Admin > Overview, 30 days', () => getOverview('30d', 'America/Phoenix'));
  await time('Admin > Configuration', () => getAdminConfig());

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
