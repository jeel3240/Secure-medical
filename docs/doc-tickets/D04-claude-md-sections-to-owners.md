# D04 · CLAUDE.md §3-§8 to their owners

**Goal:** Everything in `CLAUDE.md` §3-§8 that another doc owns moves there; what stays is the rules a session needs.

**Why:** §4's file tree (about 170 lines of per-file notes), §5's data model, §6's flows and §7's setup repeat `SCHEMA.md`, the area docs and the README, and drift from them - e.g. "9 tables" against 26, "16 of the 40 actions" against 41 (audit, 2026-11-27).

**Depends on:** D02 · **Size:** M · **Status:** Done 2026-11-27 - every part of §3-§8 in its owner, checked; the per-file lines all named in area docs; the docs check passes · **Deploy note:** none - documentation only.

## Build

- §3: the stack to `ARCHITECTURE.md`; the EZ Texting notes to `EZTEXTING-API.md`; one rule stays - the test account, the `weightloss` test group, the group filter always on;
- §4: the folder map to `ARCHITECTURE.md`; each file's line to its area doc's Code section (a ticket per area may finish it - list which here); the rule "all docs in `docs/`, updated in the same commit" stays;
- §5: the data model and every migration line to `SCHEMA.md` and its History; "only one open conversation per phone" stays as a pointer;
- §6: new lead to `POLLER.md`, reply to `STATE-MACHINE.md` and `WEBHOOKS.md`, scoring to `STATE-MACHINE.md`/`FLOWS.md`, calls to `TWILIO.md`, the queue tags to `QUEUE.md`, "every route under `/api`" to `ARCHITECTURE.md`;
- §7 to `RUNNING.md` (D06); the rule "never `twilio:configure` locally with production's number" stays;
- §8's table to `WORKFLOW.md`; the rules - never commit `.env`, no real lead data, the developer never touches EC2, RDS or client accounts - stay.

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

`CLAUDE.md` and every receiving doc.

## Not in this ticket

Writing the short CLAUDE.md (D05).

## As built

- §3: the stack and the "As built" table to `ARCHITECTURE.md` (The parts, Outside services, History); the EZ Texting notes were already `EZTEXTING-API.md`'s (Endpoints, The account); the test-account rule kept as `CLAUDE.md` rule 6; `openai` 6.x and Node 22 already `AI-AGENT.md`'s.
- §4: the folder map to `ARCHITECTURE.md`, "The parts". Every file the tree named (about 200) was checked by script against the docs: all are named in their area doc but `api/app.ts` (now in `ARCHITECTURE.md`) and `scripts/live-flow.ts` (now in `TESTING.md`), so no area needs a follow-up ticket. The "all docs in `docs/`" rule kept (rule 10), with "CLAUDE.md stays at the root".
- §5: every migration line was already in `SCHEMA.md`'s History, 001-024; the first nine-table list is in `ORIGINAL-PLAN.md`; "one open conversation per phone, ever" kept as a pointer to `SCHEMA.md`.
- §6: new lead `POLLER.md`; reply `STATE-MACHINE.md` and `WEBHOOKS.md`; scoring `STATE-MACHINE.md`, "Scoring" and `FLOWS.md`; calls and their paths `TWILIO.md`, `INCOMING-CALLS.md`, `AUTO-CALLS.md`; the queue tags' dated changes `QUEUE.md`'s History; every route under `/api` `ARCHITECTURE.md`. All were already there.
- §7 to `RUNNING.md`; the never-`twilio:configure`-with-production's-number rule kept (rule 5).
- §8's table to `WORKFLOW.md`, "Before you start"; its rules kept (rule 3).

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
