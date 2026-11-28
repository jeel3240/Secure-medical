# D08 · WORKFLOW.md and DEPLOY.md

**Goal:** `WORKFLOW.md` is branches, PRs and migrations; a new `DEPLOY.md` is the server: deploying, the images, switches, `twilio:configure`, CloudWatch, the start-up refusals, and what to do when it goes wrong.

**Why:** `WORKFLOW.md` mixes both with 21 dates; it calls the EZ Texting account live in one place and test in another; one deploy command lacks the `-f` files (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** Done 2026-11-27 - `WORKFLOW.md` and a new `DEPLOY.md`, both how-tos, every production command with both `-f` files; the docs check passes · **Deploy note:** none - documentation only.

## Build

- `WORKFLOW.md` (How-to): before you start, branch → PR → merge, migrations (the rule, "Where the files stand" as its one owner), the definition of done, History;
- `DEPLOY.md` (How-to): the steps (B02's order once built), the images, Seri's and the buckets' switches, `twilio:configure`, CloudWatch, the resend after an outage (from `POLLER.md`), "When it goes wrong" (from `LOGGING.md`'s "goes quiet");
- the credentials table to `CLAUDE.md`'s rules and `EZTEXTING-API.md`;
- every deploy command with both `-f` files.

## Done when

- [ ] the doc's sections are its type's, in the type's order (`docs/DOCS.md`)
- [ ] no dated note, "As built" or "until" aside left in the body - each is a line in History
- [ ] every fact another doc owns is a link, not a copy
- [ ] every file, function, setting and route it names exists (`grep`)
- [ ] every link resolves, and every code comment that quotes a moved or renamed section is updated
- [ ] nothing lost: each removed sentence is either still true somewhere, or in History

## Tests

The docs check (D47) once it exists; until then `grep` for every name the doc gives, and each link opened.

## Docs to update in the same commit

`WORKFLOW.md`, `DEPLOY.md`, `POLLER.md`, `LOGGING.md`, `docs/README.md`, the A22 and B46 tickets where they give commands.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

- `WORKFLOW.md` (how-to, about 170 lines): Before you start - the credentials table from `CLAUDE.md` §8 and its rules; Branches; Commits; Before opening a PR (with `npm run docs:check`); Opening the PR; The definition of done (from `CLAUDE.md` §9 and §10); Migrations, with "Where the files stand" as its one owner; When it goes wrong; the dated notes - 014-020's exception, how 006-024 went out, the 003/004 merge, the account taken for live - in History. The credentials table went to `WORKFLOW.md`, as D04 says; D08's "to `CLAUDE.md`'s rules and `EZTEXTING-API.md`" is met by rule 3 and by `EZTEXTING-API.md`, "The account", which already owned the account's rules.
- `DEPLOY.md` (how-to): Before you start; Deploying - today's steps, then B02's order as "The order planned", marked not done; The images; The first account; What stops the api starting; Pointing Twilio at the server (one step and a link to `TWILIO-SETUP.md`); the robot's switch (T26's going-live and stop steps); Seri's key and switch, and watching her first calls; Resending after an outage (the heading `POLLER.md` and three code comments quote); Logs - CloudWatch; The database - connecting to RDS (from `SCHEMA.md`); When it goes wrong - `LOGGING.md`'s two ways of going quiet and the robot's rows. The buckets' switches are pointed at `BUCKETS.md`, not built.
- Fixed: `WORKFLOW.md` called the EZ Texting account live in one place and test in another (only the test account now, the live wording in History); `docker compose exec api npm run migrate` on the server lacked the `-f` files.
- `POLLER.md` and `LOGGING.md` already linked `DEPLOY.md` (D16, D11). Tickets: A22's pointer moved to `DEPLOY.md`, "Seri, the AI agent"; B46's docs list to `DOCS.md`'s phases and `DEPLOY.md`; B02's runbook references to `DEPLOY.md`, "Deploying" and "The images".

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
