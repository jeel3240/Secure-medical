# D04 · CLAUDE.md §3-§8 to their owners

**Goal:** Everything in `CLAUDE.md` §3-§8 that another doc owns moves there; what stays is the rules a session needs.

**Why:** §4's file tree (about 170 lines of per-file notes), §5's data model, §6's flows and §7's setup repeat `SCHEMA.md`, the area docs and the README, and drift from them - e.g. "9 tables" against 26, "16 of the 40 actions" against 41 (audit, 2026-11-27).

**Depends on:** D02 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

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

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
