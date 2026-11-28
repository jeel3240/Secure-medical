# Workflow

How a change gets from a branch on a laptop to `main`: branches, commits, the
checks before a PR, the PR itself, what "done" means, and migrations - the one way
the database ever changes. Putting `main` on the server is `DEPLOY.md`; running
and testing locally are `RUNNING.md` and `TESTING.md`.

## Before you start

- **Who holds what.** A developer works with test credentials only; production's
  are Jeel's and live only in the server's `.env`:

  | Item | Who holds it | Developer gets |
  |---|---|---|
  | EZ Texting test account's credentials | Jeel | Yes |
  | EZ Texting production credentials | Jeel | No |
  | Twilio test credentials - the dev number | Jeel | Yes |
  | Twilio production | Jeel | No |
  | AWS console / IAM user | Jeel | No |
  | EC2 SSH key | Jeel | No |
  | RDS password | Jeel | No |
  | GitHub repo | Both | Write access |

- **The developer never touches EC2, RDS or the client's accounts.** Only Jeel
  deploys.
- **Never commit `.env`**, nor a real credential in any file. Never use real lead
  data locally: generate fake leads.
- **The EZ Texting account's rules** - a test account, the `weightloss` test
  group, the group filter on every contacts query - are `EZTEXTING-API.md`, "The
  account".

## Branches

`main` is what deploys. `dev` is the integration branch. Work happens on a feature
branch off `dev` and reaches `dev` through a PR. Jeel reviews and merges into
`dev`, then merges `dev` into `main` separately.

```bash
git checkout dev && git pull
git checkout -b feat/short-description
```

**Every change goes through a PR into `dev`.** Nothing is committed directly to
`dev` or `main`, and no PR targets `main`. Prefer small PRs, one concern each.

## Commits

Small and one concern each. A commit message says why the change exists, not the
diff - above all when the reason took effort to establish, like an API behaving
differently from its documentation.

The doc that owns what changed is updated in the same commit (`docs/README.md`
says which doc owns what; `DOCS.md` is how). A finding that cost time to work out
belongs in a doc, not only in a commit message.

## Before opening a PR

```bash
cd backend && npx tsc --noEmit    # must be clean
npm run typecheck:scripts         # scripts/ and the tests, with the app - must be clean
npm test                          # must pass
npm run lint                      # must pass - ESLint for the backend
scripts/live-checks.sh            # when the change touches SQL - TESTING.md, "Live checks"
npm run docs:check                # when a doc changed - DOCS.md, "Checking a doc"
cd ../frontend && npm run build   # type-checks and builds the frontend
npm test                          # must pass - Vitest
npm run lint                      # ESLint for the frontend
cd ..
docker compose build api worker   # catches what a local node_modules hides
docker compose up -d
docker compose logs -f worker     # no errors, poll ticks look right
```

The Docker build matters. TypeScript can pass locally while the image fails,
because a stale `node_modules` may still hold a package that was never added to
`package.json` - it happened once here, with `@types/pg`.

## Opening the PR

```bash
git push -u origin feat/short-description
```

Target `dev`. The description covers what changed, how to verify it, and anything
deliberately left out - a guard that is switched off, a path that is untested, a
decision that needs Jeel's input. Say so explicitly rather than letting a reviewer
discover it.

## The definition of done

A task is done when:

1. it works locally end to end with fake data;
2. its tests pass, and the live checks when it touches SQL;
3. the PR description says how to test it;
4. there are no console errors;
5. the migrations are included if the schema changed;
6. the docs it changes are updated in the same commit.

## Migrations

Plain numbered `.sql` files in `backend/src/db/migrations/`, applied by `npm run
migrate` (`backend/scripts/migrate.js`) and recorded in `schema_migrations`, so
each runs once. What each table holds is `SCHEMA.md`.

**The site is live, so every database change is a new migration file.** The
production database on RDS holds real rows. It is only ever changed by a numbered
file in this folder, run through the migrate script on deploy. There is no other
route: no `ALTER` typed into psql, no change made by hand in a GUI, no edit to a
file that has already shipped. A schema change that exists only on someone's
laptop is missing in production, and the code that depends on it fails there and
nowhere else.

**Never edit a migration that has already run.** Add a new numbered file that
changes what the old one did. Assume every file already in `dev` has run in
production unless Jeel says otherwise - that assumption is cheap when wrong and
expensive when right, because editing a file that has run leaves the two
databases permanently different with nothing to show it.

This applies to the smallest changes as much as the large ones. Adding a column,
widening one, adding an index, seeding a settings row, correcting a value: each
one is a file. `002_dnc_release.sql` exists because two columns had to be added to
`dnc_list` after 001 had shipped - that is the pattern, not an exception.

**One runner at a time.** The runner takes a Postgres advisory lock for its whole
run, so two `npm run migrate` at once cannot both apply the same file: the second
waits, then finds nothing pending. It remembers a file by its name only - an edited
file that already ran is not noticed, which is why the rule above holds; a checksum
would need a column on `schema_migrations`, a change to make by migration if it is
ever wanted.

**A migration that changes or fills in existing rows ships an upgrade check** -
a backfill, a copy, a guard that stops unless the rows are as expected. The live
checks run every migration on an empty database, which proves nothing about rows;
an upgrade check runs it over rows seeded in the old shape (`TESTING.md`,
"Upgrade checks").

**Run migrations through `npm run migrate`, never by piping SQL into psql.**
Piping applies the schema without recording it, so the runner tries to apply the
same file again later and fails.

**A migration ships in the same PR as the code that needs it,** so a deploy never
lands code expecting a column that is not there yet.

**On deploy the migrations run before the new code starts** (`DEPLOY.md`,
"Deploying"), so for a while the old code runs on the new schema. A migration must
suit the code still running: it adds - a table, a column, an index, a row - and a
drop or a rename ships in a later deploy than the change that stopped reading what
it drops (`DEPLOY.md`, "Why the migrations go first").

**Files that have not reached `main` can still be combined - with care.**
Production runs only what is on `main`. Check what it holds with `git ls-tree
origin/main backend/src/db/migrations/` before combining anything. Keep the earlier
file's name, so a database that already ran it does not run it again - the runner
remembers files by name. A local database that ran the earlier file but not the
second misses the second part: rebuild it, or run the second part's SQL there once.

### Where the files stand

`main` and production hold 001 to 024. `dev` adds 025 (B04, why a lead was
closed). The next migration is 026.

## When it goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `tsc` passes locally and `docker compose build` fails | A package the code uses is missing from `package.json`, hidden by a local `node_modules` | Add it to `package.json` and build again |
| The runner fails on a file that is already applied | The SQL was piped into psql, so `schema_migrations` never recorded it | Locally, rebuild the database (`docker compose down -v`, `up -d`, `npm run migrate` - this deletes local data); never pipe again |
| A local database misses a column that `dev` has | It ran an earlier version of a file that was edited or combined before reaching `main` | Rebuild it, or run the missing SQL there once |
| A migration needs to change what an earlier one did | The earlier one has run - or may have | A new numbered file; never edit the old one |

## History

- 2026-11-28 · 025 on `dev`: `dispositions.reason` and `conversation_id` · B04
- 2026-11-28 · A migration that changes existing rows ships an upgrade check · B03
- 2026-11-28 · On deploy the migrations run before the new code starts, so a migration suits the code still running: it adds, and a drop waits for a later deploy · B02
- 2026-11-27 · Split: deploying, the images, the switches, `twilio:configure` and CloudWatch to `DEPLOY.md`; the credentials table and the definition of done from `CLAUDE.md`; the EZ Texting account's rules to `EZTEXTING-API.md`, which owns them; `npm run docs:check` before a PR; the dated notes to this History · D08
- 2026-11-24 · `main` and production hold 001 to 024: 021, five automated calls at once for each person free (T29, `AUTO-CALLS.md`, "Traffic"), through PR #29; 022 to 024 through PR #31, applied on production at 23:29 UTC. Before, on `dev`: 022, Seri (`AI-AGENT.md`) - new columns on `calls` and `callbacks`, the add-only `call_ai_turns`, and the `ai_agent` setting seeded `off`; 023 (A15), `callbacks.note` and one call back per call she booked it on; 024 (A31), `call_ai_turns.data`, the brain's record of each reply. None changed an existing row, and the app writes the new parts only on a call Seri takes, so with her switch off calls went on as before
- 2026-11-22 · One runner at a time: the advisory lock · review M36. `npm run typecheck:scripts` added to the checks before a PR
- 2026-10-30 · 014 to 020 - automated calls, T4, T6, T9, T10, T12, T13, T15c, T16 and T17 - reached `main` and production. None changed a row production already had: 014 adds a third call direction, a column, two checks and an index; 015 the call script's four tables, its seed, and eight `settings` rows; 016 one empty column on `users`; 017 three more - the "Taking calls" switch, off for everyone, when it changed and why - and an index of the calls still going; 018 changes three of 015's own rows - the call's opening, its stop and repeat lines, and its voice - and stops if they are not exactly as 015 left them; 019 the two place-on-hold lines and `calls.held_at`, empty, with a check and an index; 020 `call_offers`, empty, an index of calls by agent and end, and one `settings` row. Deployed with `AUTO_CALLS` unset - though W1, W2, Admin > Leads' Call column and the three Configuration tabs showed at once - then switched on as T26's going-live steps say (`DEPLOY.md`); switched on, it called every lead still waiting for a reply, new leads first (T27). `npm run migrate` was run straight after the `up`: until 017 had run, the new code could not read `users` (`taking_calls`), so signing in and every page would fail. From then the rule holds again: 021 onwards are new files
- 2026-10-18 · Jeel: until automated calls are deployed as a whole, 014 onwards have not run in production and may be edited in place - 018 was, for the call's opening; a laptop that already ran the old file re-applies it by hand and says so
- 2026-10-06 · 012, the SMS flows as rows with the antibiotics script (`FLOWS.md`), and 013, three indexes for the queue and Admin > Leads (`QUEUE.md`, "How fast it is"), followed from `dev` after a walk with a real phone. 012 was edited on its branch that day, after review and before it ran anywhere but a developer's machine: a local database that ran the earlier 012 has to be rebuilt
- 2026-10-05 · 006 to 011 - the activity log, incoming calls, the callback a missed call books, the word kept with each answer, who picked up a call, and call recordings and transcripts - reached `main`
- 2026-09-28 · Jeel merged 004 into 003: neither had run on production, because `main` stopped at 002 - checked with `git ls-tree`. The `004` on disk today, `004_conversation_completed_at.sql`, is a later and unrelated file. ESLint added to the checks before a PR
- 2026-09-23 · Production live: every database change is a new migration file and nothing else - no hand edits, no psql · Jeel
- 2026-09-14 · The EZ Texting rules here were written for the client's live account, about 120,000 real contacts: every contacts query scoped to a group, `EZT_GROUP` required for it; sending only ever to a `dev-test` group of our own phones - none existed, so `sendMessage` refused while `EZT_SEND_GROUP` was unset, and it was not to be set to a real group to get a test working. The same day, Jeel: the account is a test account, `weightloss` the test group - contacts added by hand in the dashboard, source `WebInterface`; test settings `EZT_GROUP=weightloss`, `EZT_SOURCE=WebInterface`, `EZT_SEND_GROUP=weightloss`; the group filter kept on every contacts query
- 2026-09-14 · Written: branches, commits, PRs, migrations and deploying, as the practice of `CLAUDE.md` §9
