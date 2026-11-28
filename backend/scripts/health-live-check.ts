/**
 * Proves db/health.ts against a real Postgres.
 *
 * The check that matters here is the one a mock would have got wrong: the
 * poller's liveness comes from when it last read EZ Texting - the
 * `ezt_last_read_at` row (B06), else the checkpoint row's `updated_at` - not
 * from the checkpoint's value. The value is the newest contact's createdAt,
 * which stands still on a quiet account while the worker polls happily every
 * 30 seconds. Reading it would report a healthy system as dead every time leads
 * stop arriving. The sections before "when EZ Texting was last read" have no
 * `ezt_last_read_at` row: they prove the fallback.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE health_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/health_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/health_check JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x EZT_SEND_GROUP=x \
 *     npx ts-node --transpile-only scripts/health-live-check.ts
 */
import { check, failureCount, verdict } from './check';
import { pool } from '../src/db/pool';
import { getHealth, type HealthCheck } from '../src/db/health';
import { ANTIBIOTICS_FLOW } from './live-flow';


async function refuseIfNotEmpty(): Promise<void> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM leads`);
  if (rows[0].n > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }
}

const named = (checks: HealthCheck[], name: string) => checks.find((c) => c.name === name);

/** Writes when EZ Texting was last read, as the poller does (B06), that many minutes ago. */
async function setLastRead(minutesAgo: number): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('ezt_last_read_at', (now() - ($1 || ' minutes')::interval)::text, now() - ($1 || ' minutes')::interval)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [String(minutesAgo)]
  );
}

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

  console.log('\nwhen EZ Texting was last read (B06)');
  {
    // A poll that read the account but kept its checkpoint back behind a
    // contact that failed: the worker is polling.
    await setCheckpoint(new Date(), 15);
    await setLastRead(0);
    const read = named((await getHealth()).checks, 'poller');
    check('read a moment ago, checkpoint written 15 minutes ago: healthy', [read?.status, read?.detail.ageSeconds], ['ok', 0]);

    // Once the row exists it is the signal, whatever the checkpoint says.
    await setCheckpoint(new Date(), 0);
    await setLastRead(15);
    const stopped = named((await getHealth()).checks, 'poller');
    check('read 15 minutes ago, checkpoint fresh: degraded', [stopped?.status, stopped?.message?.includes('900s')], ['degraded', true]);
    check('the checkpoint\'s value still reported beside it', typeof stopped?.detail.checkpointValue, 'string');

    await pool.query(`DELETE FROM settings WHERE key = 'ezt_last_read_at'`);
    check('without the row, the checkpoint\'s time once more', named((await getHealth()).checks, 'poller')?.status, 'ok');
  }

  console.log('\nthe last inbound webhook');
  {
    const before = named((await getHealth()).checks, 'webhook');
    check('is null before any reply', before?.detail.lastInboundAt, null);
    // A quiet night is not a broken webhook, so this has no verdict: `info`,
    // not an ok that could never be anything else (2026-09-28).
    check('is information, not a pass or fail', before?.status, 'info');

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
      `INSERT INTO conversations (lead_id, flow_id, status, step, expires_at)
       VALUES ($1, ${ANTIBIOTICS_FLOW}, 'open', 1, now() - interval '1 day')`,
      [id]
    );

    const expiry = named((await getHealth()).checks, 'expiry');
    check('an unswept one is counted', expiry?.detail.conversationsPastExpiry, 1);
    // It said ok regardless until 2026-09-28.
    check('and the sweep is reported as not running', expiry?.status, 'degraded');

    // Just past its expiry is normal between sweeps.
    await pool.query(`UPDATE conversations SET expires_at = now() - interval '2 minutes' WHERE lead_id = $1`, [id]);
    check('two minutes over is still ok', named((await getHealth()).checks, 'expiry')?.status, 'ok');
    await pool.query(`UPDATE conversations SET expires_at = now() - interval '1 day' WHERE lead_id = $1`, [id]);

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
    check('and is healthy when set and nothing has failed', sending?.status, 'ok');

    // Until 2026-09-28 this checked only the setting, and said ok while EZ
    // Texting refused every text. The newest attempt now decides.
    const lead = await pool.query(
      `INSERT INTO leads (phone, first_name, source) VALUES ('+15550000803', 'Ava', 'API') RETURNING id`
    );
    const leadId = lead.rows[0].id;
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, ezt_message_id, created_at) VALUES ($1, 'outbound', 'Q1', 'ok-1', now() - interval '10 minutes')`,
      [leadId]
    );
    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, delivery_status) VALUES ($1, 'outbound', 'Q2', 'failed')`,
      [leadId]
    );
    const failing = named((await getHealth()).checks, 'sending');
    check('the newest text refused: degraded', failing?.status, 'degraded');
    check('and it counts the day\'s failures', failing?.detail.failedLastDay, 1);

    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, ezt_message_id) VALUES ($1, 'outbound', 'Q2 again', 'ok-2')`,
      [leadId]
    );
    check('a later text going out: ok again', named((await getHealth()).checks, 'sending')?.status, 'ok');
  }

  console.log(verdict());
  await pool.end();
  process.exit(failureCount() === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
