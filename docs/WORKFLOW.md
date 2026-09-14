# Workflow

How work moves from a local branch to running on the server. `CLAUDE.md`
section 9 is the policy; this is the practice.

## Branches

`main` is what deploys. `dev` is the integration branch. Work happens on a
feature branch off `dev` and reaches `dev` through a PR. Jeel merges `dev` into
`main` separately.

```bash
git checkout dev && git pull
git checkout -b feat/short-description
```

**Every change goes through a PR into `dev`.** Nothing is committed directly to
`dev` or `main`, and no PR targets `main`. The developer never touches EC2, RDS
or the client's accounts.

## Commits

Small and one concern each. A commit message should say why the change exists,
not restate the diff - especially when the reason came from something that took
effort to establish, like an API behaving differently from its documentation.

Update the relevant doc in `docs/` in the same commit as the change it
describes. A finding that cost time to work out belongs in a doc, not only in a
commit message.

## Before opening a PR

```bash
cd backend && npx tsc --noEmit    # must be clean
npm test                          # must pass
cd ../frontend && npm run build   # type-checks and builds the frontend
cd ..
docker compose build api worker   # catches what a local node_modules hides
docker compose up -d
docker compose logs -f worker     # no errors, poll ticks look right
```

The Docker build matters. TypeScript can pass locally while the image fails,
because a stale `node_modules` may still hold a package that was never added to
`package.json`. That has already happened once here, with `@types/pg`.

Definition of done, from `CLAUDE.md`: works locally end to end, the PR says how
to test it, no console errors, migrations included if the schema changed.

## Opening the PR

```bash
git push -u origin feat/short-description
```

Target `dev`. The description should cover what changed, how to verify it, and
anything deliberately left out - a guard that is switched off, a path that is
untested, a decision that needs Jeel's input. Say so explicitly rather than
letting a reviewer discover it.

## Migrations

Plain numbered `.sql` files in `backend/src/db/migrations/`, applied by
`npm run migrate` and recorded in `schema_migrations` so each runs once.

**Never edit a migration that has already run against RDS.** Add a new numbered
file. A file that has only ever run on a local database can still be edited,
since nothing depends on its previous contents - but be certain that is true
before doing it.

Run migrations through `npm run migrate`, not by piping SQL into psql.
Piping applies the schema without recording it, so the runner will try to apply
the same file again later and fail.

## Deploying

Jeel only:

```bash
ssh <ec2>
cd /opt/secure-medical
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose exec api npm run migrate
```

Production runs compiled `dist/`, not ts-node. Real credentials live in `.env`
on the server and in no committed file.

## Credentials

The EZ Texting account is the client's live account with roughly 120,000 real
contacts. Two standing rules:

- Every contacts query is scoped to a group. `EZT_GROUP` is required for this
  reason.
- Sending is only ever to a `dev-test` group of our own phones. No such group
  exists yet, so `sendMessage` refuses to send while `EZT_SEND_GROUP` is unset.
  Do not set it to a real group to get a test working.

**Update 2026-09-14 (Jeel):** the EZ Texting account is a test account, not the
client's live account. The text above is kept for history. `weightloss` is the
test group: contacts are added to it by hand in the dashboard and arrive with
source `WebInterface`. Test settings are `EZT_GROUP=weightloss`,
`EZT_SOURCE=WebInterface` and `EZT_SEND_GROUP=weightloss`. Keep the group filter
on every contacts query.
