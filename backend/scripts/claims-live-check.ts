/**
 * Proves db/claims.ts against a real Postgres.
 *
 * The jest tests mock the database, so they cover the route contract and
 * nothing else. The rule that matters - two agents cannot both hold a lead -
 * lives entirely in one UPDATE's WHERE clause, and only a real database can
 * show whether it holds when both fire at once.
 *
 * It writes rows, so it refuses to run against a database that holds any. Make
 * a scratch one:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE claims_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/claims_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/claims_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/claims-live-check.ts
 *
 * Re-running needs a fresh database: DROP and re-migrate.
 */
import { pool } from '../src/db/pool';
import { claimLead, releaseLead } from '../src/db/claims';

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
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM leads)::int AS leads,
            (SELECT count(*) FROM users)::int AS users`
  );
  if (rows[0].leads > 0 || rows[0].users > 0) {
    console.error('Refusing to run: this database already holds rows. Use a scratch database.');
    process.exit(1);
  }
}

async function makeUser(name: string, active = true): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, is_active)
     VALUES ($1, 'x', $2, 'agent', $3) RETURNING id`,
    [`${name.toLowerCase()}@example.com`, name, active]
  );
  return rows[0].id;
}

async function makeLead(phone: string): Promise<number> {
  const { rows } = await pool.query(`INSERT INTO leads (phone) VALUES ($1) RETURNING id`, [phone]);
  return rows[0].id;
}

async function holderOf(leadId: number): Promise<number | null> {
  const { rows } = await pool.query(`SELECT assigned_to FROM leads WHERE id = $1`, [leadId]);
  return rows[0]?.assigned_to ?? null;
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  const maya = await makeUser('Maya');
  const sam = await makeUser('Sam');
  const gone = await makeUser('Gone', false);

  console.log('\nclaiming');
  {
    const lead = await makeLead('+15550000001');
    const first = await claimLead(lead, maya);
    check('an unclaimed lead is claimed', first.ok, true);
    check('the holder is the claimer', await holderOf(lead), maya);

    const second = await claimLead(lead, sam);
    check('a second agent is refused', second.ok === false && second.reason, 'already_claimed');
    check(
      'the refusal names the holder',
      second.ok === false && second.reason === 'already_claimed' && second.heldBy.name,
      'Maya'
    );
    check('the holder is unchanged', await holderOf(lead), maya);
  }

  console.log('\nre-claiming your own lead');
  {
    const lead = await makeLead('+15550000002');
    const first = await claimLead(lead, maya);
    const at = first.ok ? first.claim.claimedAt : null;

    await new Promise((r) => setTimeout(r, 20));
    const again = await claimLead(lead, maya);

    check('succeeds', again.ok, true);
    // Opening a lead twice is not a new claim, so the timestamp a superadmin
    // reads to spot an abandoned lead must not keep resetting.
    check('leaves claimed_at alone', again.ok && again.claim.claimedAt, at);
  }

  console.log('\na claim held by a deactivated agent');
  {
    const lead = await makeLead('+15550000003');
    await claimLead(lead, gone);
    const taken = await claimLead(lead, maya);

    // The queue already ignores such a claim. If the endpoint disagreed, a lead
    // would look free in the list and refuse to be taken.
    check('does not block another agent', taken.ok, true);
    check('the lead moves to the new holder', await holderOf(lead), maya);
  }

  console.log('\ntwo agents claiming at the same moment');
  {
    const lead = await makeLead('+15550000004');
    const [a, b] = await Promise.all([claimLead(lead, maya), claimLead(lead, sam)]);

    const winners = [a, b].filter((r) => r.ok).length;
    check('exactly one wins', winners, 1);
    check('the other is told it is claimed', [a, b].some((r) => !r.ok && r.reason === 'already_claimed'), true);

    const holder = await holderOf(lead);
    check('the database holds one of them', holder === maya || holder === sam, true);
  }

  console.log('\nreleasing');
  {
    const lead = await makeLead('+15550000005');
    await claimLead(lead, maya);

    const bySomeoneElse = await releaseLead(lead, sam, false);
    check('an agent cannot release another agent', bySomeoneElse.ok === false && bySomeoneElse.reason, 'not_yours');
    check('the holder is unchanged', await holderOf(lead), maya);

    const byOwner = await releaseLead(lead, maya, false);
    check('the holder can release it', byOwner.ok, true);
    check('the lead is free', await holderOf(lead), null);
  }

  console.log('\nsuperadmin force-release');
  {
    const lead = await makeLead('+15550000006');
    await claimLead(lead, maya);

    // The answer to a claim that never expires.
    const forced = await releaseLead(lead, sam, true);
    check('takes it off another agent', forced.ok, true);
    check('the lead is free', await holderOf(lead), null);
  }

  console.log('\nreleasing a lead nobody holds');
  {
    const lead = await makeLead('+15550000007');
    // The caller wanted it free, and it is.
    check('succeeds', (await releaseLead(lead, maya, false)).ok, true);
  }

  console.log('\nleads that do not exist');
  {
    const claim = await claimLead(999999, maya);
    check('claiming reports not_found', claim.ok === false && claim.reason, 'not_found');
    const release = await releaseLead(999999, maya, false);
    check('releasing reports not_found', release.ok === false && release.reason, 'not_found');
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
