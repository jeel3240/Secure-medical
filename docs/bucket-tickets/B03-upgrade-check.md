# B03 · The upgrade check

**Goal:** a migration that changes or fills in existing rows is proved on a database
in the old shape, not only on an empty one.

**Why:** `scripts/live-checks.sh` gives each live check a freshly migrated, **empty**
database, so a backfill is never run against rows. Phase 8 has several (B04, B07, B09,
B13, B15, B33, B35); each must be exact on production's data.

**Depends on:** - · **Size:** S · **Status:** Done 2026-11-28 - `harness-upgrade-check`
passes in the full live-check run, and fails on a changed value · **Deploy note:** none -
test tooling only.

## Build

- `backend/scripts/migrate.js`: an optional stop point, `--to NNN` - apply files up to
  and including `NNN_*.sql`, then stop. Same advisory lock, same one transaction per
  file, same `schema_migrations` record. Without it, unchanged.
- An upgrade check is a script named `scripts/<name>-upgrade-check.ts` that:
  1. migrates its empty database to the version it names (`--to`);
  2. seeds rows in that version's shape, with plain SQL - never through today's
     `db/` functions, which expect the new shape;
  3. runs the remaining migrations;
  4. checks every seeded row came through as the migration promises, with
     `scripts/check.ts`'s `check`, and ends with `verdict()`.
- `scripts/live-checks.sh`: for a file named `*-upgrade-check.ts`, create the empty
  database but **skip** its own `migrate.js` step - the check drives the migrations.
  The output and the summary line are the same as for any live check.
- One first check that proves the harness on what exists:
  `scripts/harness-upgrade-check.ts` - migrate to 021, seed a lead, a conversation, an
  automated call and a disposition in 021's shape, migrate on to the latest, check
  every row is untouched and the 022-024 defaults are what those migrations say.

## Done when

- [x] `node scripts/migrate.js --to 021` stops after 021, and a second run without
      `--to` applies the rest - both from an empty database.
- [x] `scripts/live-checks.sh harness-upgrade-check` passes, and fails when one
      expected value is changed (seen once, then put back).
- [x] `scripts/live-checks.sh` with no arguments still runs every live check, the
      upgrade checks included.

## Tests

The harness check itself; the two `migrate.js` runs.

## Docs to update in the same commit

- `docs/TESTING.md`: the upgrade check, how to write one.
- `docs/WORKFLOW.md`, "Migrations": a migration that changes existing rows ships an
  upgrade check.
- The tracker's rules already name it.

## Not in this ticket

The upgrade checks of later migrations - each migration ticket writes its own.

## As built

- **`migrate.js --to NNN`**: three digits, refused otherwise ("usage: ..."), refused
  for a number with no file and for a database already past it ("the database
  already holds 022_ai_agent.sql"). It prints "applied 21 migration(s) up to 021" /
  "no pending migrations up to 021". Without it, unchanged - the production image's
  `npm run migrate` still applies all 24 to an empty database.
- **Helpers in `scripts/upgrade.ts`**, so each check is only its seed and its
  checks: `migrateTo(to?)` runs `migrate.js` and returns its last line;
  `refuseUnlessEmpty()`; `rowsOf(table)`; `asBefore(before, after)` - the rows cut
  to the columns they had; `hasColumn`.
- **The harness check migrates to 024, not straight to the latest.** 022-024's
  promises are checked at 024; then `migrateTo()` runs the rest and the check
  compares `schema_migrations` with the folder. A later migration that drops or
  changes a seeded column (B13) would otherwise break this check's row
  comparison; this way the harness stays true and still runs every later
  migration over 021-shaped rows.
- **Runs:** `--to 021` on an empty database stopped at 21 files; a second run
  without it applied 022-024. `live-checks.sh harness-upgrade-check`: 15 ok; with
  the expected `ai_agent` changed to `on`, "1 check(s) FAILED", exit 1; put back,
  15 ok. Given a migrated database it refuses. `live-checks.sh` with no arguments
  runs it among the 24.
- **Docs:** `TESTING.md` ("Upgrade checks", two rows of "When it goes wrong"),
  `WORKFLOW.md` ("Migrations"), and one line in `SCHEMA.md`'s steps for changing
  the schema.

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
