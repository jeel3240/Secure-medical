/**
 * Proves db/health.ts against a real Postgres.
 *
 * The check that matters here is the one a mock would have got wrong: the
 * poller's liveness comes from `settings.updated_at`, not from the checkpoint's
 * value. The value is the newest contact's createdAt, which stands still on a
 * quiet account while the worker polls happily every minute. Reading it would
 * report a healthy system as dead every time leads stop arriving.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE health_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/health_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/health_check REDIS_URL=x JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x EZT_SEND_GROUP=x \
 *     npx ts-node --transpile-only scripts/health-live-check.ts
 */
import { pool } from '../src/db/pool';
import { getHealth, type HealthCheck } from '../src/db/health';

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

const named = (checks: HealthCheck[], name: string) => checks.find((c) => c.name === name);

/** Writes the checkpoint the way the poller does, with updated_at set explicitly. */
async function setCheckpoint(value: Date, updatedMinutesAgo: number): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('ezt_poll_checkpoint', $1, now() - ($2 || ' minutes')::interval)
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [value.toISOString(), String(updatedMinutesAgo)]
  );
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  console.log('\nbefore the poller has ever run');
  {
    const health = await getHealth();
    const poller = named(health.checks, 'poller');

    check('the database answers', named(health.checks, 'database')?.status, 'ok');
    check('and reports a round trip', typeof named(health.checks, 'database')?.detail.roundTripMs, 'number');
    check('the poller is degraded', poller?.status, 'degraded');
    check('and says it may never have run', poller?.message?.includes('never'), true);
    check('so the whole report is degraded', health.status, 'degraded');
  }

  console.log('\na poller that just ran');
  {
    await setCheckpoint(new Date(), 0);
    const health = await getHealth();

    check('is healthy', named(health.checks, 'poller')?.status, 'ok');
    check('with no message', named(health.checks, 'poller')?.message, null);
    check('and the report is ok', health.status, 'ok');
  }

  console.log('\nthe signal is when the poll ran, not what it found');
  {
    // The case this whole file exists for: a quiet account. The checkpoint's
    // value is a week old because no new contact has arrived, but the worker
    // polled a moment ago and is perfectly healthy.
    const aWeekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
    await setCheckpoint(aWeekAgo, 0);

    const poller = named((await getHealth()).checks, 'poller');
    check('a stale value with a fresh poll is healthy', poller?.status, 'ok');
    check('the age is measured from the poll', poller?.detail.ageSeconds, 0);
    // Shown so the two are not confused by whoever reads the response.
    check('and the value is reported separately', poller?.detail.checkpointValue, aWeekAgo.toISOString());
  }

  console.log('\na worker that has stopped');
  {
    // Fresh value, but nothing has polled for 15 minutes: the inverse of the
    // case above, and the one that must raise the alarm.
    await setCheckpoint(new Date(), 15);
    const poller = named((await getHealth()).checks, 'poller');

    check('is degraded', poller?.status, 'degraded');
    check('and says so in seconds', poller?.message?.includes('900s'), true);
    check('the threshold is reported', poller?.detail.staleAfterSeconds, 360);
  }

  console.log('\nthe edges of the stale window');
  {
    await setCheckpoint(new Date(), 5);
    check('five minutes is still healthy', named((await getHealth()).checks, 'poller')?.status, 'ok');

    await setCheckpoint(new Date(), 7);
    check('seven minutes is not', named((await getHealth()).checks, 'poller')?.status, 'degraded');

    await setCheckpoint(new Date(), 0);
  }

  console.log('\nthe last inbound webhook');
  {
    const before = named((await getHealth()).checks, 'webhook');
    check('is null before any reply', before?.detail.lastInboundAt, null);
    // A quiet night is not a broken webhook, so this never sets the verdict.
    check('and never degrades the report', before?.status, 'ok');

    const lead = await pool.query(
      `INSERT INTO leads (phone, first_name, source) VALUES ('+15550000801', 'Jordan', 'API') RETURNING id`
    );
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, from_number, received_at)
       VALUES ($1, 'inbound', 'hi', '+15550000801', now() - interval '2 minutes')`,
      [lead.rows[0].id]
    );

    const after = named((await getHealth()).checks, 'webhook');
    check('is found once one arrives', after?.detail.lastInboundAt !== null, true);
    check('with its age', after?.detail.ageSeconds, 120);
  }

  console.log('\nconversations past their expiry');
  {
    const lead = await pool.query(
      `INSERT INTO leads (phone, first_name, source) VALUES ('+15550000802', 'Sam', 'API') RETURNING id`
    );
    const id = lead.rows[0].id;

    await pool.query(
      `INSERT INTO conversations (lead_id, status, step, expires_at)
       VALUES ($1, 'open', 1, now() - interval '1 day')`,
      [id]
    );

    const expiry = named((await getHealth()).checks, 'expiry');
    check('an unswept one is counted', expiry?.detail.conversationsPastExpiry, 1);

    // A conversation the sweep has already closed is not counted again.
    await pool.query(`UPDATE conversations SET status = 'expired' WHERE lead_id = $1`, [id]);
    check(
      'a swept one is not',
      named((await getHealth()).checks, 'expiry')?.detail.conversationsPastExpiry,
      0
    );
  }

  console.log('\nsending configuration');
  {
    const sending = named((await getHealth()).checks, 'sending');
    // EZT_SEND_GROUP is set in the command above; without it every send is
    // refused, which otherwise shows up only as failures in the log.
    check('is reported', sending?.detail.sendGroupSet, true);
    check('and is healthy when set', sending?.status, 'ok');
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
