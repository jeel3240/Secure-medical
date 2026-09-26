/**
 * Proves the three admin read models against a real Postgres:
 * db/admin-config.ts, db/admin-overview.ts, db/admin-dnc.ts.
 *
 * These are almost entirely SQL - aggregates, FILTER clauses, a four-way UNION,
 * a lateral join - and a mocked pool says nothing about any of it. The config
 * page especially: its job is to show the values the state machine is really
 * using, so checking it against seeded rows is the only way to know it does.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE admin_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/admin_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/admin_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/admin-live-check.ts
 */
import { pool } from '../src/db/pool';
import { getAdminConfig } from '../src/db/admin-config';
import { getOverview } from '../src/db/admin-overview';
import { listDnc } from '../src/db/admin-dnc';
import { blockNumber, DNC_REASONS, releaseNumber } from '../src/db/dnc';

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
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM leads`);
  if (rows[0].n > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }
}

async function makeUser(name: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'x', $2, 'agent') RETURNING id`,
    [`${name.toLowerCase()}@example.com`, name]
  );
  return rows[0].id;
}

interface LeadSpec {
  phone: string;
  first?: string;
  last?: string;
  status?: string;
  score?: number;
  tier?: string | null;
  /** Days ago the lead arrived. 0 is today. */
  daysAgo?: number;
}

async function makeLead(spec: LeadSpec): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO leads (phone, first_name, last_name, source, ezt_added_at)
     VALUES ($1, $2, $3, 'API', now() - ($4 || ' days')::interval) RETURNING id`,
    [spec.phone, spec.first ?? 'Jordan', spec.last ?? null, String(spec.daysAgo ?? 0)]
  );
  const id = rows[0].id;
  if (spec.status) {
    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, score, tier)
       VALUES ($1, $2, 3, $3, $4)`,
      [id, spec.status, spec.score ?? 0, spec.tier ?? null]
    );
  }
  return id;
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  console.log('\nConfiguration reads what the state machine uses');
  {
    const config = await getAdminConfig();

    // Against the rows seeded by 001_init.sql.
    check('the three questions and more are shown', config.messages.length, 7);
    check('the opener is first', config.messages[0].key, 'question_1');
    check('and is personalised', config.messages[0].personalised, true);

    // message_stop is deliberately absent: EZ Texting sends the unsubscribe
    // confirmation, we never do - STATE-MACHINE.md rule 1.
    check('the STOP copy is not shown as ours', config.messages.some((m) => m.key === 'message_stop'), false);

    check('the maximum is computed from the rules', config.scoring.maxScore, 100);
    check('the tier bands come from the table', config.tiers.map((t) => t.name), ['HOT', 'WARM', 'LOW']);
    check('HOT starts at 75', config.tiers[0].minScore, 75);
    check('expiry is 7 days', config.settings.expiryDays, 7);
    check('the flat awards are separated from the answers', config.scoring.awards.length, 2);
    check('question 1 has three choices', config.scoring.questions[0].choices.length, 3);

    // With no leads yet, the fallback name is the worst case.
    check('the worst case uses the fallback when there are no leads', config.longestFirstName, 'there');
  }

  console.log('\nthe segment count follows the longest real name');
  {
    const opener = (await getAdminConfig()).messages[0];
    const before = opener.worstCaseLength;

    await makeLead({ phone: '+15550000701', first: 'Christopher' });
    const after = (await getAdminConfig()).messages[0];

    check('the longest name is found', (await getAdminConfig()).longestFirstName, 'Christopher');
    // "Christopher" is longer than "there", so the worst case grows.
    check('and the worst case grows with it', after.worstCaseLength > before, true);
    check('the stored length is unchanged', after.length, opener.length);
    // The seeded opener was written to stay in one segment even for a long name.
    check('the opener still costs one segment', after.segments, 1);
    check('and is not flagged', after.costsExtraSegment, false);
  }

  console.log('\nConfiguration follows an edited rule');
  {
    await pool.query(`UPDATE scoring_rules SET points = 50 WHERE code = 'q3_1'`);
    const config = await getAdminConfig();

    // 10 + 10 + 15 + 30 + 50. Hardcoding 100 would have hidden this.
    check('the maximum is recomputed', config.scoring.maxScore, 115);
    await pool.query(`UPDATE scoring_rules SET points = 35 WHERE code = 'q3_1'`);
  }

  console.log('\nOverview counts leads in the period');
  {
    const maya = await makeUser('Maya');
    const sam = await makeUser('Sam');

    await makeLead({ phone: '+15550000702', status: 'completed', score: 100, tier: 'HOT' });
    await makeLead({ phone: '+15550000703', status: 'open', score: 25, tier: 'LOW' });
    await makeLead({ phone: '+15550000704', status: 'open', score: 0, tier: null });
    // Outside every window but 30d.
    await makeLead({ phone: '+15550000705', status: 'completed', score: 90, tier: 'HOT', daysAgo: 10 });

    const today = await getOverview('today');
    // +15550000701 from the section above has no conversation, so it counts as
    // received but not responded.
    check('received today', today.kpis.leadsReceived, 4);
    check('responded is score > 0', today.kpis.responded, 2);
    check('completed', today.kpis.completed, 1);
    check('HOT', today.kpis.hot, 1);
    check('responded percentage', today.kpis.respondedPct, 50);

    const thirty = await getOverview('30d');
    check('30d reaches further back', thirty.kpis.leadsReceived, 5);
    check('and finds the older completion', thirty.kpis.completed, 2);

    const sevenDay = await getOverview('7d');
    check('7d excludes the 10-day-old lead', sevenDay.kpis.leadsReceived, 4);

    console.log('\nthe funnel and the per-agent table');
    const lead = await makeLead({ phone: '+15550000706', status: 'completed', score: 80, tier: 'HOT' });
    await pool.query(`INSERT INTO dispositions (lead_id, agent_id, value) VALUES ($1, $2, 'interested')`, [lead, maya]);
    await pool.query(`INSERT INTO dispositions (lead_id, agent_id, value) VALUES ($1, $2, 'no_answer')`, [lead, maya]);
    await pool.query(`INSERT INTO notes (lead_id, agent_id, body) VALUES ($1, $2, 'spoke briefly')`, [lead, sam]);
    await pool.query(
      `INSERT INTO callbacks (lead_id, agent_id, scheduled_at) VALUES ($1, $2, now() + interval '1 hour')`,
      [lead, sam]
    );

    const after = await getOverview('today');
    const mayaRow = after.agents.find((a) => a.name === 'Maya');
    const samRow = after.agents.find((a) => a.name === 'Sam');

    // Sorted: jsonb_object_agg promises no key order, and check() compares
    // through JSON.stringify, which would make that order significant.
    const sortedEntries = (o: Record<string, number> | undefined) =>
      Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b));
    check("Maya's dispositions are counted by value", sortedEntries(mayaRow?.dispositions), [
      ['interested', 1],
      ['no_answer', 1],
    ]);
    check('Sam has none', sortedEntries(samRow?.dispositions), []);
    check("Sam's pending callback is counted", samRow?.callbacksPending, 1);
    check('and Maya has none pending', mayaRow?.callbacksPending, 0);

    check('the funnel narrows', after.funnel.map((f) => f.count), [5, 3, 2, 0, 1]);
    // Twilio is Phase 4, so every call figure is structurally zero.
    check('calls are zero', after.kpis.callsMade, 0);
    check('and the screen is told why', after.callsBuilt, false);

    console.log('\nthe activity feed');
    const kinds = after.activity.map((a) => a.kind).sort();
    check('covers every agent action', kinds, ['callback', 'disposition', 'disposition', 'note']);
    check('newest first', after.activity[0].at >= after.activity[1].at, true);
    check('and names the lead', after.activity[0].leadName, 'Jordan');
  }

  console.log('\nthe DNC list');
  {
    await blockNumber(pool, '+15550000702', DNC_REASONS.smsStop);
    await blockNumber(pool, '+15550000703', DNC_REASONS.agentDisposition);
    // A number we hold no lead for, which the table allows.
    await blockNumber(pool, '+15559999999', DNC_REASONS.eztOptOut);
    await releaseNumber(pool, '+15550000703');

    const all = await listDnc();
    check('shows every row', all.total, 3);
    check('counts each state', all.counts, { all: 3, blocked: 2, released: 1 });

    const released = all.rows.find((r) => r.phone === '+15550000703');
    check('a released row is shown as released', released?.blocked, false);
    check('with its reason', released?.releasedReason, 'sms_start');
    check('and keeps why it was blocked', released?.reason, DNC_REASONS.agentDisposition);

    const blocked = await listDnc({ state: 'blocked' });
    check('the blocked filter excludes it', blocked.rows.some((r) => r.phone === '+15550000703'), false);
    check('and the counts still cover every tab', blocked.counts.released, 1);

    const orphan = all.rows.find((r) => r.phone === '+15559999999');
    check('a number with no lead is listed', orphan !== undefined, true);
    check('with no lead attached', orphan?.lead, null);

    const attached = all.rows.find((r) => r.phone === '+15550000702');
    check('a number with a lead names it', attached?.lead?.name, 'Jordan');

    console.log('\nsearching it');
    // Typed the way an admin would, with punctuation.
    const bySearch = await listDnc({ q: '(555) 999-9999' });
    check('digits are matched through formatting', bySearch.rows.map((r) => r.phone), ['+15559999999']);

    const wildcard = await listDnc({ q: '%' });
    // Without escaping, "%" would match every row.
    check('a wildcard is not a wildcard', wildcard.rows.length, 0);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
