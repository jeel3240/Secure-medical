# Secure Medical - working in this repo

A web app for a call center: it takes in leads from EZ Texting, texts them a short
qualification flow, scores them into a priority queue (HOT / WARM / LOW), lets about
ten agents call them from the browser through Twilio, and calls those who never
reply - the robot's script, or Seri, the AI agent. 50-100 leads a day; no HIPAA.
Production is live. The parts and why: `docs/ARCHITECTURE.md`; a lead's life:
`docs/LEAD-FLOW.md`.

## The rules

1. **Every change reaches the repo through a PR into `dev`.** Branch off `dev`, push
   the branch, open the PR against `dev` - never against `main`, and never commit to
   either directly. Jeel reviews and merges, and merges `dev` into `main`. Small PRs,
   one concern each (`docs/WORKFLOW.md`).
2. **Production is live, so every database change is a new numbered migration** in
   `backend/src/db/migrations/`, run by `npm run migrate` - no hand edits, no psql.
   Never edit a migration that has run: add one (`docs/WORKFLOW.md`, "Migrations").
3. **No secrets, no real data.** Never commit `.env`, nor a real credential in any
   file. Production's credentials are Jeel's and live only on the server; a
   developer gets the test ones and never touches EC2, RDS or the client's accounts
   (`docs/WORKFLOW.md`, "Before you start"). Never use real lead data locally:
   generate fake leads.
4. **Production runs compiled `dist/`, never ts-node.** Its settings are in
   `docker-compose.prod.yml`, and every production command names both compose files
   (`docs/DEPLOY.md`).
5. **Never run `twilio:configure` (or `dev:twilio:configure`) from a laptop whose
   `.env` holds production's number, (480) 470-8259** - check `TWILIO_PHONE_NUMBER`
   first, and if it is that number, stop and say so. Local work uses the dev number,
   (480) 530-8582 (`docs/TWILIO-SETUP.md`, "Before you start").
6. **The EZ Texting account behind the local credentials is a test account.** Its
   `weightloss` group is the test group, and every contacts query is scoped to a
   group (`docs/EZTEXTING-API.md`, "The account").
7. **Nothing may be lost.** The company keeps data as proof: every action a person or
   the system can take records itself in the activity log, in the same statement or
   transaction, and nothing overwrites or deletes the only record of something
   (`docs/AUDIT.md`).
8. **No names but Jeel's** in any committed file - docs, comments, fixtures,
   knowledge files - and no real lead's number or name: phone numbers only in the
   555 range and the two Twilio numbers (`docs/DOCS.md`, rules 5 and 8).
9. **The code wins over a doc.** Do not assume how something works from its name,
   and do not trust a doc over the code: check, then fix whichever is wrong.
10. **Every area has one doc, updated in the same commit as the change** - not
    afterwards, not in a follow-up. `docs/README.md` says which doc owns what;
    `docs/DOCS.md` is how a doc is written, and `/new-phase` how a phase is planned.
    All documentation lives in `docs/`, except the root `README.md` and this file,
    which stays at the root, where Claude Code loads it.
    A finding that cost time to establish belongs in a doc, not only in a commit.
11. **`docs/STATE-MACHINE.md` is the SMS flow's spec** and overrides the mockup PDF,
    which is a reference for screens and wording, not for flow logic.
12. **Before a PR:** `npm test` and `npm run lint` in `backend/` and `frontend/`,
    and `docker compose build api worker` - a local `node_modules` can hide a
    dependency missing from `package.json`. The full list, and the definition of
    done, are `docs/WORKFLOW.md`'s.

## Where things are

| Before touching | Read |
|---|---|
| Anything, if the app is new to you | `docs/LEAD-FLOW.md`, then `docs/ARCHITECTURE.md` |
| Running or testing it locally | `docs/RUNNING.md`, `docs/TESTING.md` |
| The poller, a send or the EZ Texting webhook | `docs/EZTEXTING-API.md` first, then `docs/POLLER.md`, `docs/WEBHOOKS.md` |
| The SMS flow | `docs/STATE-MACHINE.md`; a flow's rows, or how answers are stored, `docs/FLOWS.md` |
| The data model or a migration | `docs/SCHEMA.md` - one open conversation per phone, ever - and `docs/WORKFLOW.md`, "Migrations" |
| Sign-in, sessions, roles or the `users` table | `docs/AUTH.md` |
| The queue | `docs/QUEUE.md` |
| A lead's page: claiming, notes, outcomes, SMS | `docs/AGENT-WORKSPACE.md`; callbacks `docs/CALLBACKS.md`; the timeline `docs/TIMELINE.md` |
| An admin screen | `docs/ADMIN.md` - read-only by decision, but for Agents and Seri's switch; Admin > Leads `docs/ADMIN-LEADS.md` |
| Calls an agent places, Twilio's webhooks, the Call button | `docs/TWILIO.md`; a lead calling in `docs/INCOMING-CALLS.md`; the Twilio account and `twilio:configure` `docs/TWILIO-SETUP.md` |
| The robot's calls | `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md` |
| Seri, the AI agent | `docs/AI-AGENT.md`, `docs/AI-BRAIN.md`, `docs/AI-RELAY.md`, `docs/AI-KNOWLEDGE.md` |
| Several buckets (Phase 8) | `docs/BUCKETS.md` and its tickets |
| Anything a person or the system can do | `docs/AUDIT.md` |
| A log line or the health check | `docs/LOGGING.md` |
| An environment variable | `docs/ENVIRONMENT.md` |
| The frontend | `docs/DESIGN-PROMPT.md`, the brief; `docs/FRONTEND.md`, what was built; `docs/FRONTEND-STYLE.md`; the mockup PDF for layouts and wording |
| Branches, PRs, the definition of done | `docs/WORKFLOW.md` |
| The server: deploying, switches, logs | `docs/DEPLOY.md` |
| A doc, or planning a phase | `docs/DOCS.md` and `/new-phase`; every doc is in `docs/README.md` |
| What was first planned | `docs/ORIGINAL-PLAN.md` |

## The order of work, every time

1. **Understand what is already there.** Read the existing code and the doc for that
   area before changing anything. Skipping this is how the `createdAt` bug got
   written: the plan's field names were taken on trust and the poller silently
   ingested nothing.
2. **Make the change.**
3. **Verify it.** Run it. A change that has not been executed is not done.
4. **Update the doc, in the same commit.** In depth: what changed, why, and what the
   change does not cover. If no doc exists for that area, create it from
   `docs/templates/` and add it to `docs/README.md`.
5. **Open a PR into `dev`.** Never commit to `main` or `dev` directly.

## History

- 2026-11-27 · Cut from 870 lines to the rules and where things are. The architecture and the stack to `docs/ARCHITECTURE.md`; the file tree to its folder map and each area doc's Code; the data model to `docs/SCHEMA.md`; the core flows to their owners; local setup to `docs/RUNNING.md`; the credentials table and the definition of done to `docs/WORKFLOW.md`; deploying to `docs/DEPLOY.md`; the four-week plan, the Phase 3 task list and the progress and phases tables to `docs/ORIGINAL-PLAN.md`, the phases' summaries to `docs/DOCS.md`, "The phases", and their state to each design doc's Status line; "Admin is read-only" to `docs/ADMIN.md`'s Decisions · D02-D05
- 2026-11-24 · Production holds migrations 001-024; Seri's switch on Admin > Configuration as well as the command · A22
- 2026-11-23 · The file read against the code by the whole-repo review: its tree, the Phase 7 rows and the live checks' coverage corrected · review R1-R4
- 2026-10-05 to 2026-11-27 · Phases 5 to 8 added to the phases table as each was decided: flows, automated calls, Seri, several buckets
- 2026-10-05 · Never `twilio:configure` locally with production's number; until 2026-10-16 calling was not tested locally at all · Jeel
- 2026-10-01 · Nothing may be lost: a new action records itself in the activity log · Jeel
- 2026-09-28 · ESLint before every PR
- 2026-09-23 · Work tracked in phases; Admin read-only except Agents; production live, so every database change is a new migration file · Jeel
- 2026-09-19 · `docs/STATE-MACHINE.md` overrides the mockup for the flow · Jeel
- 2026-09-14 · "As built" notes beside the plan; the EZ Texting account is a test account · Jeel
- 2026-09-10 · Written as the plan and the instructions: what we build, the architecture and why, the stack, the layout, the data model, the core flows, local setup, credentials, the workflow, the four-week plan, working with Claude Code (`docs/ORIGINAL-PLAN.md`)
