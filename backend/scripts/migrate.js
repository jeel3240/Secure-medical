// Runs every .sql file in src/db/migrations in filename order, once each.
// Applied migrations are recorded in schema_migrations. Never edit a file
// that has already run against RDS; add a new numbered file instead.
//
//   node scripts/migrate.js            # everything not yet applied
//   node scripts/migrate.js --to 021   # only up to and including 021_*.sql
//
// `--to` is for upgrade checks (B03): one migrates an empty database to an old
// version, seeds rows in that version's shape, then runs the rest - so a
// migration that changes existing rows is proved on rows (docs/TESTING.md,
// "Upgrade checks"). Production never passes it.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');
// One runner at a time (review M36, 2026-11-22): two `npm run migrate` at once
// both saw a file as pending and both applied it. A second waits here until the
// first is done, then finds nothing pending. Any constant: this lock is ours.
const RUNNER_LOCK = 4_702_215;

/** A file's number: 21 for `021_calls_per_person.sql`. */
const numberOf = (file) => Number(file.split('_')[0]);

/** `--to NNN`, or null without it. Anything else on the command line is refused. */
function stopPoint(args, files) {
  if (args.length === 0) return null;
  if (args.length !== 2 || args[0] !== '--to' || !/^\d{3}$/.test(args[1])) {
    throw new Error(`usage: node scripts/migrate.js [--to NNN] - got: ${args.join(' ')}`);
  }
  if (!files.some((f) => f.startsWith(`${args[1]}_`))) {
    throw new Error(`--to ${args[1]}: there is no migration ${args[1]}_*.sql`);
  }
  return Number(args[1]);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Missing required env var: DATABASE_URL');
    process.exit(1);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const to = stopPoint(process.argv.slice(2), files);

  // Same reason as src/db/pool.ts: RDS certs are signed by Amazon's CA, which
  // Node does not trust, so a sslmode=require URL fails verification. Encrypted
  // without the issuer check; RDS is only reachable from inside the VPC.
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [RUNNER_LOCK]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    // Stopping at an old version on a database already past it would leave it
    // looking older than it is.
    const beyond = to === null ? [] : [...applied].filter((f) => numberOf(f) > to).sort();
    if (beyond.length > 0) {
      throw new Error(`--to ${String(to).padStart(3, '0')}: the database already holds ${beyond[0]}`);
    }

    let ran = 0;
    for (const file of files) {
      if (to !== null && numberOf(file) > to) break;
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${file} failed: ${err.message}`);
      }
    }

    const upTo = to === null ? '' : ` up to ${String(to).padStart(3, '0')}`;
    console.log(ran === 0 ? `no pending migrations${upTo}` : `applied ${ran} migration(s)${upTo}`);
  } finally {
    // Released by the session ending too; said so all the same.
    await client.query('SELECT pg_advisory_unlock($1)', [RUNNER_LOCK]).catch(() => undefined);
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
