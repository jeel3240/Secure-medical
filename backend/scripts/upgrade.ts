/**
 * What every upgrade check shares - B03, docs/TESTING.md, "Upgrade checks".
 *
 * A live check gets an empty database, migrated to the latest, so a migration
 * that changes or fills in existing rows is never run against any. An upgrade
 * check proves it on rows: it migrates an empty database to the version before
 * (`migrateTo('021')`), seeds rows in that version's shape with plain SQL -
 * never through `src/db/`, whose functions expect today's shape - runs the
 * rest (`migrateTo()`), and checks every row with `check`.
 *
 * A file named `*-upgrade-check.ts` is run by `scripts/live-checks.sh` on an
 * empty database it does not migrate: the check does.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { pool } from '../src/db/pool';

type Row = Record<string, unknown>;

/**
 * Runs `scripts/migrate.js` against `DATABASE_URL`: up to and including `to`
 * (`'021'`), or everything. Returns its last line - "applied 21 migration(s) up
 * to 021" - and throws with the runner's own error when a migration fails.
 */
export function migrateTo(to?: string): string {
  const args = [path.join(__dirname, 'migrate.js'), ...(to === undefined ? [] : ['--to', to])];
  try {
    const out = execFileSync(process.execPath, args, { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim().split('\n').pop() ?? '';
  } catch (err) {
    const failed = err as { stderr?: string; message: string };
    throw new Error(`migrate.js${to === undefined ? '' : ` --to ${to}`} failed: ${(failed.stderr || failed.message).trim()}`);
  }
}

/** Stops the check unless the database has never been migrated: an upgrade check starts from nothing. */
export async function refuseUnlessEmpty(): Promise<void> {
  const { rows } = await pool.query<{ migrated: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS migrated`
  );
  if (rows[0].migrated) {
    console.error(
      'Refusing to run: this database has been migrated already.\n' +
        'An upgrade check migrates an empty database itself - make a new one, or run it through scripts/live-checks.sh.'
    );
    process.exit(1);
  }
}

/**
 * Every row of a table, as JSON, in id order - taken before the migrations, to
 * compare with after. `table` is a name written in the check, never input.
 */
export async function rowsOf(table: string): Promise<Row[]> {
  const { rows } = await pool.query<{ row: Row }>(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY t.id`);
  return rows.map((r) => r.row);
}

/**
 * The rows read after the migrations, each cut down to the columns its row had
 * before: what an upgrade must leave exactly as it was. A row missing after
 * comes back as `null`, so the comparison shows it.
 */
export function asBefore(before: Row[], after: Row[]): (Row | null)[] {
  return before.map((was) => {
    const now = after.find((r) => r.id === was.id);
    return now ? Object.fromEntries(Object.keys(was).map((k) => [k, now[k]])) : null;
  });
}

/** Whether a table has a column - how a check sees a migration has, or has not, run. */
export async function hasColumn(table: string, column: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}
