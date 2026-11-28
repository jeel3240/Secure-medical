# D05 · CLAUDE.md, short

**Goal:** `CLAUDE.md` is about 100-120 lines: what the app is, the rules every session needs, and where everything is.

**Why:** It is read at the start of every Claude session; at 870 lines with about 150 dates it buries the rules (audit, 2026-11-27). `DOCS.md`, "Map".

**Depends on:** D02, D03, D04, D06 · **Size:** S · **Status:** Done 2026-11-27 - `CLAUDE.md` 107 lines - the rules, where things are, the order of work, History; every old rule kept or owned · **Deploy note:** none - documentation only.

## Build

- an H1, then: what the app is (4 lines); **The rules** - PRs into `dev` only, Jeel merges `dev` to `main`; production is live, every database change a new numbered migration, never edit one that ran; no secrets, no real lead data; prod runs `dist/`, prod settings in `docker-compose.prod.yml`; never `twilio:configure` locally with (480) 470-8259; nothing may be lost (`AUDIT.md`); the code wins over a doc, run it, update the doc in the same commit, follow `DOCS.md` and `/new-phase`; `STATE-MACHINE.md` overrides the mockup; before a PR: tests, lint, `docker compose build api worker`;
- **Where things are** - a short table: before touching X, read Y (from §12);
- **The order of work** (§12's five steps), unchanged in substance;
- no dates in the body; a History section with one line per earlier shape of the file.

## Done when

- [ ] `wc -l CLAUDE.md` about 120 or less;
- [ ] every rule in today's CLAUDE.md is either kept or owned by a doc it points to - a list in *As built*.
- [ ] the doc's sections are its type's, in the type's order (`docs/DOCS.md`)
- [ ] no dated note, "As built" or "until" aside left in the body - each is a line in History
- [ ] every fact another doc owns is a link, not a copy
- [ ] every file, function, setting and route it names exists (`grep`)
- [ ] every link resolves, and every code comment that quotes a moved or renamed section is updated
- [ ] nothing lost: each removed sentence is either still true somewhere, or in History

## Tests

The docs check (D47) once it exists; until then `grep` for every name the doc gives, and each link opened.

## Docs to update in the same commit

`CLAUDE.md`, root `README.md`.

## Not in this ticket

Moving content (D02-D04, D06 do).

## As built

- `CLAUDE.md`, 107 lines: what the app is; The rules (12); Where things are (a 22-row "before touching, read" table); The order of work; History, one line per earlier shape. No dates in the body, no phase rows.
- Every rule of the old file, and where it is now: PRs into `dev` only, never a commit to `dev` or `main`, Jeel merges `dev` to `main`, small PRs - rule 1 (`WORKFLOW.md`); production live, every database change a new migration, never edit one that ran, no psql - rule 2 (`WORKFLOW.md`, "Migrations"); never commit `.env`, no real credentials in any file, production credentials Jeel's, the developer never touches EC2, RDS or client accounts, no real lead data, generate fake leads - rule 3 (`WORKFLOW.md`, "Before you start"); prod runs `dist/`, prod settings in `docker-compose.prod.yml` - rule 4 (`DEPLOY.md`); never `twilio:configure` locally with (480) 470-8259, check `TWILIO_PHONE_NUMBER`, stop and say so - rule 5 (`TWILIO-SETUP.md`); the test account, `weightloss`, the group filter - rule 6 (`EZTEXTING-API.md`); nothing may be lost - rule 7 (`AUDIT.md`); no names but Jeel's - rule 8, new here from the memory notes (`DOCS.md` rules 5 and 8); the code wins, do not trust a doc over the code - rule 9; one doc per area, updated in the same commit, all docs in `docs/`, `CLAUDE.md` stays at the root, a costly finding belongs in a doc - rule 10; `STATE-MACHINE.md` overrides the mockup - rule 11; tests, lint and `docker compose build api worker` before a PR - rule 12 (`WORKFLOW.md`); the definition of done - `WORKFLOW.md`; one open conversation per phone - the table, `SCHEMA.md`; Admin read-only but for Agents and Seri's switch, changed by migration, Jeel makes the changes - the table, `ADMIN.md`'s Decisions; "architecture decided, not open for debate" - `ARCHITECTURE.md`'s Decisions; "do not start the next week until its done-when is met" - the plan's, `ORIGINAL-PLAN.md`; every "read X before Y" - the table; the order of work and the `createdAt` lesson - kept.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
