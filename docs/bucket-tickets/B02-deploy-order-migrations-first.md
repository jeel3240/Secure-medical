# B02 · Deploy order: migrations before the new code

**Goal:** a deploy runs the new image's migrations before the new api and worker
start, so new code never runs against the old database.

**Why:** the runbook (`docs/DEPLOY.md`, "Deploying") runs
`up -d --build`, then `exec api npm run migrate`. Between the two, the new code runs on
the old schema: a robot call's `/auto/*` webhook or Seri's greeting that reads a column
its migration adds would answer 500 (review of the Phase 8 plan, 2026-11-27). Several
Phase 8 tickets add a column and read it in the same merge.

**Depends on:** - · **Size:** S · **Status:** Done 2026-11-28 - the new order run
locally and the production image migrating a scratch database · **Deploy note:** this
ticket is the deploy note for the rest.

## Build

- Check that the **production** image can run the migrations: the Dockerfile's
  `production` stage (`docs/DEPLOY.md`, "The images") must carry
  `backend/scripts/migrate.js` and `backend/src/db/migrations/*.sql`. If it does not,
  this ticket adds them - the one code change it may make.
- `docs/DEPLOY.md`, "Deploying", in this order - written there today as "The order planned":
  1. `git pull`;
  2. `docker compose -f docker-compose.yml -f docker-compose.prod.yml build api worker`;
  3. `docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm api npm run migrate`
     - the new image, against the database, while the old containers still run;
  4. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
- Why that order is safe, written beside it: a migration that **adds** is invisible to
  the old code still running; a migration that **drops** ships only in a deploy after
  the code stopped reading what it drops (expand, switch, contract - the tracker's
  rules).
- The old order kept as a dated note, not deleted.

## Done when

- [x] Locally, on a scratch database: `docker compose build api worker`, then
      `docker compose run --rm api npm run migrate`, then `docker compose up -d`, and
      the app answers - the output in *As built*.
- [x] The production stage proven able to migrate: `docker build --target production`
      and `npm run migrate` run from that image against a scratch database.
- [x] Every doc that gives the deploy commands says the same thing (`grep` for
      `up -d --build` and `npm run migrate`).

## Tests

The commands above, run and pasted into *As built*. No unit test: this is the runbook.

## Docs to update in the same commit

`docs/DEPLOY.md` ("Deploying", and "The order planned" folded into it);
`docs/WORKFLOW.md` ("Migrations"); the A22 ticket's runbook lines, if they quote the
old order.

## Not in this ticket

Automating deploys; any rollback tooling.

## As built

- **No code change.** The `production` stage already carries `scripts/migrate.js`
  and `src/db/migrations/` (since review H13). The only file besides the docs is
  `docker-compose.prod.yml`'s header comment, which gave the old `up -d --build`.
- **`build`, not `build api worker`.** The order as planned built only the api and
  the worker; `up -d` does not build, so the frontend - built into the Caddy
  image - would have stayed on the old version. `build` with no service named
  builds the api, the worker and Caddy (`docker compose ... config` lists those
  three with a build; postgres is `dev-only`).
- **Run locally** (the dev images; only the api started, as a local worker polls
  the EZ Texting test account): `docker compose build api worker` - built;
  `docker compose run --rm -e DATABASE_URL=.../deploy_b02 api npm run migrate` -
  "applied 24 migration(s)", nothing new started; the same again - "no pending
  migrations"; the local database - "no pending migrations"; `docker compose up -d
  api` - `/api/health` 200 `{"status":"ok"}`; the api stopped again after, as it was.
- **The production image:** `docker build --target production`, then `docker run
  ... npm run migrate` on a scratch database - "applied 24 migration(s)"; inside it
  `whoami` is `node`, `scripts/` holds `migrate.js`, 24 migration files, no ts-node.
- **The docs agree.** `grep` for `up -d --build` and `npm run migrate`: `DEPLOY.md`
  (the runbook, Seri's key, two rows of "When it goes wrong"), `WORKFLOW.md`
  ("Migrations") and the compose comment changed. The old order stays only in
  History lines, Done tickets and `ORIGINAL-PLAN.md`, a brief. A22's Build quotes
  it for the deploy of 2026-11-24, already done; what A22 has left is the switch,
  so it was not edited. "The order planned" folded into "Deploying", with "Why the
  migrations go first" and "During a deploy" beside it; nothing cited the old name.
- **The tracker's deploy notes** now say the migrations run first, and what a
  migration must therefore be.
- **Reviewed 2026-11-28, after group A:** the order was proved in pieces - the new
  image migrating a scratch database while the old code ran, then `up -d api` -
  not as one run of the production runbook, whose `build` under
  `docker-compose.prod.yml` builds the Caddy image too. `DEPLOY.md` and
  `WORKFLOW.md` both said how a migration suits the old code; `DEPLOY.md` now points
  to `WORKFLOW.md`, "Migrations", which owns it.

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
