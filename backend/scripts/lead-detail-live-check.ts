/**
 * Proves db/lead-detail.ts against a real Postgres.
 *
 * The jest tests mock the database, so they cover status codes and nothing
 * else. What lives only in the SQL: which conversation is picked when a lead
 * has several, that a released dnc_list row no longer raises the DNC flag, and
 * that a claim by a deactivated agent is not reported as a holder.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE detail_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/detail_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/detail_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/lead-detail-live-check.ts
 */
import { pool } from '../src/db/pool';
import { getLeadDetail } from '../src/db/lead-detail';
import { listQueue } from '../src/db/queue';
import { replyAs, startFlow } from './live-flow';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  }
}

async function refuseIfNotEmpty(): Promise<void> {
  const { rows } = await pool.query(`SELECT count(*)::int AS leads FROM leads`);
  if (rows[0].leads > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }
}

async function makeLead(phone: string, over: Record<string, unknown> = {}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, last_name, source, has_unread_inbound, ezt_added_at)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [phone, over.firstName ?? 'Jordan', over.lastName ?? 'Meyer', over.source ?? 'API', over.unread ?? false]
  );
  return rows[0].id;
}

async function makeUser(name: string, active = true): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, is_active)
     VALUES ($1, 'x', $2, 'agent', $3) RETURNING id`,
    [`${name.toLowerCase()}@example.com`, name, active]
  );
  return rows[0].id;
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  console.log('\na completed lead');
  {
    const lead = await makeLead('+15550000201');
    // Yes, Yes, Talk to an agent: 10 + 20 + 15 + 45 + 10.
    await startFlow(lead, ['1', '1', '2']);

    const d = await getLeadDetail(lead);
    check('score and tier', [d?.conversation?.score, d?.conversation?.tier], [100, 'HOT']);
    check(
      'chips read as words',
      d?.chips.map((c) => `${c.heading}: ${c.answer}`),
      ['Requested info: Yes', 'Used telemedicine: Yes', 'Next step: Talk to an agent']
    );
    check(
      'the breakdown adds up to the score',
      d?.breakdown.reduce((n, l) => n + l.points, 0),
      100
    );
    check('no flags raised', d?.flags, { dnc: false, needsReview: false, unread: false, expired: false, missedCall: false });
  }

  console.log('\nthe newest conversation wins');
  {
    const lead = await makeLead('+15550000202');
    // An old conversation that answered Yes and went quiet, then a new one
    // that answered No.
    const old = await startFlow(lead, ['1']);
    await pool.query(
      `UPDATE conversations SET status = 'expired', current_question_id = NULL, created_at = now() - interval '30 days' WHERE id = $1`,
      [old]
    );
    await startFlow(lead, ['2']);

    const d = await getLeadDetail(lead);
    // History stays on the lead; the card shows the conversation in play.
    check('reports the newer one', d?.conversation?.status, 'open');
    check('and its answer, not the old one', d?.chips.map((c) => c.answer), ['No']);
    check('expired flag follows the newest', d?.flags.expired, false);
  }

  console.log('\na blocked number');
  {
    const lead = await makeLead('+15550000203');
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, score) VALUES ($1, 'suppressed', null, 10)`,
      [lead]
    );
    await pool.query(`INSERT INTO dnc_list (phone, reason) VALUES ($1, 'sms_stop')`, ['+15550000203']);

    check('raises the DNC flag', (await getLeadDetail(lead))?.flags.dnc, true);

    // A number that texted START is contactable again - migration 002.
    await pool.query(
      `UPDATE dnc_list SET released_at = now(), released_reason = 'sms_start' WHERE phone = $1`,
      ['+15550000203']
    );
    check('a released row no longer blocks', (await getLeadDetail(lead))?.flags.dnc, false);
  }

  console.log('\nflags');
  {
    const review = await makeLead('+15550000204', { unread: true });
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, invalid_count, score)
       VALUES ($1, 'review', 1, 2, 10)`,
      [review]
    );
    const d = await getLeadDetail(review);
    check('needs review', d?.flags.needsReview, true);
    check('unread', d?.flags.unread, true);

    const expired = await makeLead('+15550000205');
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, score) VALUES ($1, 'expired', 1, 10)`,
      [expired]
    );
    check('expired', (await getLeadDetail(expired))?.flags.expired, true);
  }

  console.log('\nwho is working it');
  {
    const lead = await makeLead('+15550000206');
    await pool.query(`INSERT INTO conversations (lead_id, status, step, score) VALUES ($1, 'open', 1, 10)`, [lead]);

    const maya = await makeUser('Maya');
    await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [lead, maya]);
    check('reports the holder', (await getLeadDetail(lead))?.claimedBy?.name, 'Maya');

    const gone = await makeUser('Gone', false);
    await pool.query(`UPDATE leads SET assigned_to = $2 WHERE id = $1`, [lead, gone]);
    // The queue ignores a deactivated agent's claim; the card has to agree, or
    // it would show a lead as held by someone who cannot work it.
    check('ignores a deactivated agent', (await getLeadDetail(lead))?.claimedBy, null);
  }

  console.log('\na part-way lead');
  {
    const lead = await makeLead('+15550000207');
    await startFlow(lead, ['1']);

    const d = await getLeadDetail(lead);
    check('shows only what was earned', d?.breakdown.map((l) => [l.label, l.points]), [['Responded', 10], ['Yes', 20]]);
    check('one chip per question answered - none for what is still to come', d?.chips.map((c) => c.heading), ['Requested info']);
  }

  console.log('\na lead with no conversation');
  {
    const lead = await makeLead('+15550000208');
    const d = await getLeadDetail(lead);
    check('returns the lead', d?.id, lead);
    check('with no conversation', d?.conversation, null);
    check('and an empty breakdown', d?.breakdown, []);
  }

  console.log('\na lead that does not exist');
  check('is null', await getLeadDetail(999999), null);

  console.log('\n"No", then offers');
  {
    const lead = await makeLead('+15550000209');
    await startFlow(lead, ['2', '1']);
    const d = await getLeadDetail(lead);
    check('the chips are the two questions they were asked', d?.chips.map((c) => `${c.heading}: ${c.answer}`), [
      'Requested info: No',
      'Offers: Special offers',
    ]);
    check('no completion award: they did not finish the questions', d?.breakdown.map((l) => [l.label, l.points]), [
      ['Responded', 10],
      ['No', 0],
      ['Special offers', 0],
    ]);
    check('and how it ended is on the card', [d?.conversation?.flow, d?.conversation?.endOutcome], ['antibiotics', 'offers']);
  }

  console.log('\nan answer keeps the word and the points it had when it was given');
  {
    const answersOf = async (lead: number) =>
      (
        await pool.query(
          `SELECT question_key, choice, label, points FROM conversation_answers WHERE lead_id = $1 ORDER BY position`,
          [lead]
        )
      ).rows;

    const early = await makeLead('+15550000230');
    await startFlow(early, ['1']);
    check('saved as its own row, when the answer is given', await answersOf(early), [
      { question_key: 'q1', choice: '1', label: 'Yes', points: 20 },
    ]);
    await replyAs(early, 'not sure');
    check('an unclear reply saves nothing', (await answersOf(early)).length, 1);
    await replyAs(early, '2');
    check('the next answer adds its own row and leaves the first', (await answersOf(early)).map((a) => a.label), ['Yes', 'No']);

    // The client renames choice 1 of question 1 and changes what it is worth.
    await pool.query(
      `UPDATE flow_choices SET label = 'Yes, I did', points = 25
       WHERE choice = '1' AND question_id = (
         SELECT fq.id FROM flow_questions fq JOIN flows f ON f.id = fq.flow_id WHERE f.key = 'antibiotics' AND fq.key = 'q1')`
    );
    const late = await makeLead('+15550000231');
    await startFlow(late, ['1']);
    const first = async (lead: number) => (await getLeadDetail(lead))?.breakdown.find((l) => l.code === 'q1_1');
    check('a lead who answers after the change gets the new word and points', await first(late), { code: 'q1_1', label: 'Yes, I did', points: 25 });
    check('one who answered before it keeps what they chose and earned', await first(early), { code: 'q1_1', label: 'Yes', points: 20 });

    // The queue holds finished leads; finish these two so it lists them.
    await replyAs(early, '2');
    await replyAs(late, '1');
    await replyAs(late, '2');
    const queue = (await listQueue({ limit: 200 })).leads;
    check('and in the queue', [queue.find((l) => l.id === early)?.answers[0].label, queue.find((l) => l.id === late)?.answers[0].label], [
      'Yes',
      'Yes, I did',
    ]);

    let refused = '';
    await pool.query(`UPDATE conversation_answers SET label = 'changed' WHERE lead_id = $1`, [early]).catch((err: Error) => {
      refused = err.message;
    });
    check('a saved answer cannot be edited', refused, 'conversation_answers is add-only: rows cannot be changed or deleted');
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
