/**
 * Proves migration 016 and db/presence.ts against a real Postgres - T9,
 * docs/AUTO-CALLS.md "Who is free".
 *
 * What a mock cannot show: that "I can take a call" holds for two minutes and
 * then lapses by itself, so a closed or sleeping browser stops counting with
 * nobody clearing it; that "not now" and ending a session clear it at once;
 * and that a deactivated account can never be made ringable. Getting those
 * wrong rings a desk nobody is at, or a person who signed out.
 *
 * It writes rows, so it refuses to run against a database that holds users.
 * Run it with the others: scripts/live-checks.sh presence
 */
import { pool } from '../src/db/pool';
import { RINGABLE_SECONDS, RINGABLE_SQL, setRingable } from '../src/db/presence';
import { pgUserStore } from '../src/db/users';

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
  const { rows } = await pool.query(`SELECT count(*)::int AS users FROM users`);
  if (rows[0].users > 0) {
    console.error('Refusing to run: this database already holds users. Use a scratch database.');
    process.exit(1);
  }
}

async function makeUser(email: string): Promise<number> {
  const user = await pgUserStore.create({
    email,
    name: email.split('@')[0],
    role: 'agent',
    passwordHash: 'not-a-real-hash',
    mustChangePassword: false,
  });
  return user.id;
}

/** Whether the shared rule counts this person as able to ring now. */
async function ringable(userId: number): Promise<boolean> {
  const { rows } = await pool.query(`SELECT ${RINGABLE_SQL} AS ringable FROM users u WHERE u.id = $1`, [userId]);
  return rows[0].ringable;
}

/** Whole seconds until it lapses, or null when cleared. */
async function secondsLeft(userId: number): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT round(extract(epoch FROM ringable_until - now()))::int AS left FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0].left;
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();
  const maya = await makeUser('maya@example.com');
  const sam = await makeUser('sam@example.com');

  console.log('\nsaying so');
  {
    check('a new account is not ringable - nothing has said it can be', await ringable(maya), false);
    check('and holds nothing', await secondsLeft(maya), null);

    await setRingable(pool, maya, true);
    check('"I can take a call" makes it ringable', await ringable(maya), true);
    check(`for ${RINGABLE_SECONDS} seconds`, await secondsLeft(maya), RINGABLE_SECONDS);
    check('only for that person', await ringable(sam), false);

    await pool.query(`UPDATE users SET ringable_until = now() + interval '30 seconds' WHERE id = $1`, [maya]);
    await setRingable(pool, maya, true);
    check('saying it again starts the two minutes again', await secondsLeft(maya), RINGABLE_SECONDS);

    await setRingable(pool, maya, false);
    check('"not now" - a call, a ring or a note open - clears it at once', await ringable(maya), false);
    check('and holds nothing', await secondsLeft(maya), null);

    await setRingable(pool, maya, false);
    check('"not now" twice is still not ringable', await ringable(maya), false);
  }

  console.log('\nfalling silent');
  {
    await setRingable(pool, maya, true);
    // The two minutes have passed with no word from the browser: closed, offline, asleep.
    await pool.query(`UPDATE users SET ringable_until = now() - interval '1 second' WHERE id = $1`, [maya]);
    check('two minutes with no word: no longer ringable, with nothing clearing it', await ringable(maya), false);

    await pool.query(`UPDATE users SET ringable_until = now() + interval '1 second' WHERE id = $1`, [maya]);
    check('a second before that, still ringable', await ringable(maya), true);
  }

  console.log('\nending the session');
  {
    await setRingable(pool, maya, true);
    await setRingable(pool, sam, true);
    await pgUserStore.update(maya, { bumpSession: true });
    check('signing out clears it at once', await ringable(maya), false);
    check("and leaves everyone else's", await ringable(sam), true);

    await pgUserStore.update(maya, { name: 'Maya Chen' });
    await setRingable(pool, maya, true);
    await pgUserStore.update(maya, { name: 'Maya C.' });
    check('a change that does not end the session leaves it', await ringable(maya), true);
  }

  console.log('\na deactivated account');
  {
    await setRingable(pool, sam, true);
    // As the Agents screen deactivates: is_active off, and every session ended.
    await pgUserStore.update(sam, { isActive: false, bumpSession: true });
    check('deactivating clears it at once', await ringable(sam), false);

    await setRingable(pool, sam, true);
    check('and a browser still open cannot make it ringable again', await ringable(sam), false);
    check('nothing is held for it', await secondsLeft(sam), null);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
