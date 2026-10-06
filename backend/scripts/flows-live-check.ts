/**
 * Proves what the flow tables are for - docs/FLOWS.md - against a real
 * Postgres: a second flow, with five questions and a branch, is added **as
 * rows only** and a lead is taken through it by the same code that runs the
 * antibiotics flow. No table, no column and no code is added for it.
 *
 * Also proves what migration 012 seeded, and that the two flows do not leak
 * into each other: a lead stays in the flow it started in.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 * `scripts/live-checks.sh flows` gives it a scratch database.
 */
import { getAdminConfig } from '../src/db/admin-config';
import { loadFlow, startConversation } from '../src/db/flows';
import { getLeadDetail } from '../src/db/lead-detail';
import { pool } from '../src/db/pool';
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

let nextPhone = 900;
async function makeLead(name: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, source) VALUES ($1, $2, 'API') RETURNING id`,
    [`+15550000${nextPhone++}`, name]
  );
  return rows[0].id;
}

const conversationOf = async (leadId: number) =>
  (
    await pool.query(
      `SELECT f.key AS flow, c.status, c.step, c.score, c.tier, c.end_outcome
       FROM conversations c JOIN flows f ON f.id = c.flow_id WHERE c.lead_id = $1`,
      [leadId]
    )
  ).rows[0];

async function main(): Promise<void> {
  const { rows: existing } = await pool.query(`SELECT count(*)::int AS n FROM leads`);
  if (existing[0].n > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }

  console.log('\nwhat the migration seeded');
  {
    const flows = (await pool.query(`SELECT key, is_active FROM flows ORDER BY id`)).rows;
    check('two flows: the retired one, and the one new leads get', flows, [
      { key: 'wellness', is_active: false },
      { key: 'antibiotics', is_active: true },
    ]);
    const antibiotics = (await loadFlow(pool, (await pool.query(`SELECT id FROM flows WHERE key = 'antibiotics'`)).rows[0].id))!;
    check('antibiotics: four questions, with two, two, three and three choices', antibiotics.questions.map((q) => [q.key, q.choices.length]), [
      ['q1', 2],
      ['q2', 2],
      ['q3', 3],
      ['offers', 3],
    ]);
    const q1 = antibiotics.questions[0];
    check('"No" on question 1 leads to the offers question, not question 2', antibiotics.questions.find((q) => q.id === q1.choices[1].nextQuestionId)?.key, 'offers');
    check('every text names eDrugstore, never Secure Medical',
      antibiotics.questions.some((q) => /secure medical/i.test(q.body + q.clarifyBody)) || /secure medical/i.test(antibiotics.reviewBody), false);
    let refused = '';
    await pool.query(`INSERT INTO flows (key, name, responded_points, review_body, is_active) VALUES ('second', 'Second', 10, 'x', true)`).catch((err: Error) => {
      refused = err.message;
    });
    check('only one flow can be the one new leads get', /flows_one_active/.test(refused), true);

    // The rules a migration adding a flow is held to, by the database.
    const refusedBy = async (sql: string) => {
      let message = '';
      await pool.query(sql).catch((err: Error) => {
        message = err.message;
      });
      return message;
    };
    check(
      'a flow cannot award nothing for replying: "score above 0" is how a reply is known',
      /responded_points/.test(
        await refusedBy(`INSERT INTO flows (key, name, responded_points, review_body) VALUES ('zero', 'Zero', 0, 'x')`)
      ),
      true
    );
    check(
      'a choice cannot lead into another flow',
      /flow_choices_next_in_flow/.test(
        await refusedBy(
          `UPDATE flow_choices c SET next_question_id = (SELECT q.id FROM flow_questions q JOIN flows f ON f.id = q.flow_id WHERE f.key = 'wellness' AND q.key = 'q2'), ending = NULL
           WHERE c.choice = '1' AND c.question_id = (SELECT q.id FROM flow_questions q JOIN flows f ON f.id = q.flow_id WHERE f.key = 'antibiotics' AND q.key = 'q3')`
        )
      ),
      true
    );
  }

  console.log('\na lead in the antibiotics flow');
  const first = await makeLead('First');
  {
    await startFlow(first, ['1']);
    check('starts in the active flow and moves on', await conversationOf(first), {
      flow: 'antibiotics',
      status: 'open',
      step: 2,
      score: 30,
      tier: 'LOW',
      end_outcome: null,
    });
  }

  {
    const other = await makeLead('Crossed');
    let refused = '';
    await pool
      .query(
        `INSERT INTO conversations (lead_id, status, step, flow_id, current_question_id)
         SELECT $1, 'open', 1, (SELECT id FROM flows WHERE key = 'antibiotics'),
                (SELECT q.id FROM flow_questions q JOIN flows f ON f.id = q.flow_id WHERE f.key = 'wellness' AND q.key = 'q1')`,
        [other]
      )
      .catch((err: Error) => {
        refused = err.message;
      });
    check('a conversation cannot be on a question of another flow', /conversations_question_in_flow/.test(refused), true);
  }

  console.log('\na second flow, added as rows only: five questions and a branch');
  {
    // What a migration for a new group would contain - nothing but inserts.
    await pool.query(`UPDATE flows SET is_active = false`);
    await pool.query(
      `INSERT INTO flows (key, name, responded_points, completed_points, review_body, is_active)
       VALUES ('weight', 'Weight loss', 5, 15, 'Thanks! Someone will be in touch.', true)`
    );
    await pool.query(
      `INSERT INTO flow_questions (flow_id, key, position, body, clarify_body, heading)
       SELECT f.id, 'w' || n, n, 'Weight question ' || n || '? Reply 1 or 2.', 'Sorry, weight question ' || n || ': reply 1 or 2.', 'Weight ' || n
       FROM flows f, generate_series(1, 5) n WHERE f.key = 'weight'`
    );
    // Choice 1 always goes on to the next question; choice 2 of question 2
    // skips to question 5; the fifth ends it.
    await pool.query(
      `INSERT INTO flow_choices (flow_id, question_id, choice, label, words, points, reply_body, next_question_id, ending)
       SELECT q.flow_id, q.id, c.choice, 'W' || q.position || c.label, ARRAY[lower(c.label)], c.points,
              CASE WHEN c.choice = '1' THEN 'Got it.' END,
              CASE WHEN q.position = 5 THEN NULL
                   WHEN q.position = 2 AND c.choice = '2' THEN last.id
                   ELSE nq.id END,
              CASE WHEN q.position = 5 THEN 'completed' END
       FROM flow_questions q
       JOIN flows f ON f.id = q.flow_id AND f.key = 'weight'
       CROSS JOIN (VALUES ('1', 'A', 10), ('2', 'B', 2)) AS c(choice, label, points)
       LEFT JOIN flow_questions nq ON nq.flow_id = q.flow_id AND nq.position = q.position + 1
       JOIN flow_questions last ON last.flow_id = q.flow_id AND last.position = 5`
    );

    const all = await makeLead('AllFive');
    await startConversation(pool, all, 'open');
    check('a new lead now starts in the new flow, on its first question', await conversationOf(all), {
      flow: 'weight',
      status: 'open',
      step: 1,
      score: 0,
      tier: null,
      end_outcome: null,
    });
    const afterFirst = await replyAs(all, 'a');
    check('a reply is answered from that flow: its reply and its next question, one text', afterFirst?.result.send, [
      'Got it.',
      'Weight question 2? Reply 1 or 2.',
    ]);
    for (const text of ['1', '1', '1']) await replyAs(all, text);
    check('four answers in, it is still asking', (await conversationOf(all)).step, 5);
    await replyAs(all, '1');
    // 5 for replying, five answers at 10, 15 for finishing.
    check('the fifth answer finishes it, scored by its own points', await conversationOf(all), {
      flow: 'weight',
      status: 'completed',
      step: 5,
      score: 70,
      tier: 'WARM',
      end_outcome: 'completed',
    });
    const answers = (await pool.query(`SELECT question_key, label FROM conversation_answers WHERE lead_id = $1 ORDER BY position`, [all])).rows;
    check('five answers, five rows', answers.map((a) => `${a.question_key}:${a.label}`), ['w1:W1A', 'w2:W2A', 'w3:W3A', 'w4:W4A', 'w5:W5A']);

    const skipper = await makeLead('Skipper');
    await startConversation(pool, skipper, 'open');
    await replyAs(skipper, '1');
    const jumped = await replyAs(skipper, 'b');
    check('its branch works: choice 2 of question 2 skips to question 5', [jumped?.result.conversation.step, jumped?.result.send], [5, ['Weight question 5? Reply 1 or 2.']]);
    await replyAs(skipper, '2');
    check('three answers for a lead who skipped two questions', (await getLeadDetail(skipper))?.chips.map((c) => c.heading), ['Weight 1', 'Weight 2', 'Weight 5']);

    console.log('\nthe screens show whatever the lead\'s flow asked');
    const queue = (await listQueue({ limit: 200 })).leads;
    check('the queue row carries all five answers', queue.find((l) => l.id === all)?.answers.length, 5);
    const card = await getLeadDetail(all);
    check('the lead card names its flow', card?.conversation?.flow, 'weight');
    check('and its breakdown adds up to its score', card?.breakdown.reduce((n, l) => n + l.points, 0), 70);
    const config = await getAdminConfig();
    check('Configuration describes the flow new leads get', [config.flow?.key, config.scoring.questions.length], ['weight', 5]);
  }

  console.log('\na lead stays in the flow it started in');
  {
    // The antibiotics lead from before, answering after the new flow went live.
    const next = await replyAs(first, '2');
    check('its next reply is answered from its own flow', next?.result.send[1],
      'Ready to move forward? Reply 1. I know which antibiotic I need, 2. Talk to an agent for options & discounts, 3. Order online.');
    await replyAs(first, '3');
    check('and it finishes there', await conversationOf(first), {
      flow: 'antibiotics',
      status: 'completed',
      step: 3,
      score: 55,
      tier: 'WARM',
      end_outcome: 'completed',
    });
    const schema = (await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'flow%'`)).rows[0].n;
    check('two flows, and still the same three flow tables', schema, 3);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
