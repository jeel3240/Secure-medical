# B02 · Deploy order: migrations before the new code

**Goal:** a deploy runs the new image's migrations before the new api and worker
start, so new code never runs against the old database.

**Why:** the runbook (`docs/DEPLOY.md`, "Deploying") runs
`up -d --build`, then `exec api npm run migrate`. Between the two, the new code runs on
the old schema: a robot call's `/auto/*` webhook or Seri's greeting that reads a column
its migration adds would answer 500 (review of the Phase 8 plan, 2026-11-27). Several
Phase 8 tickets add a column and read it in the same merge.

**Depends on:** - · **Size:** S · **Status:** To do · **Deploy note:** this ticket is
the deploy note for the rest.

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

- [ ] Locally, on a scratch database: `docker compose build api worker`, then
      `docker compose run --rm api npm run migrate`, then `docker compose up -d`, and
      the app answers - the output in *As built*.
- [ ] The production stage proven able to migrate: `docker build --target production`
      and `npm run migrate` run from that image against a scratch database.
- [ ] Every doc that gives the deploy commands says the same thing (`grep` for
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

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
