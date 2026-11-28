# D16 · POLLER.md

**Goal:** `POLLER.md` in the Area template, saying how the poller works today.

**Why:** "One hung connection stopped all four" - five tasks now; "every 30 seconds" - the worker waits 30 s after each cycle ends; repeat leads still "unverified" beside the 2026-11-27 answer (audit, 2026-11-27).

**Depends on:** D01, D08 · **Size:** M · **Status:** Done 2026-11-27 - POLLER.md in the area template; the docs check passes but for DEPLOY.md, still being written · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History;
- "Resending after an outage" to `DEPLOY.md`; the 2026-10-16 production run and "the other two failures in task 27" to History;
- the stale lines fixed; repeat leads: the check's answer, linking `EZTEXTING-API.md` and `BUCKETS.md`.

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

`docs/README.md`'s table if a doc is added, renamed or its type changes; the tracker's row.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

- `POLLER.md` in the area template: the cycle's five tasks (`worker/index.ts`), and the wait of `poll_interval_seconds` after each cycle ends, read again each time - not "every 30 seconds".
- Repeat leads under Not done with the 2026-11-27 answer - `createdAt` does not move, a return shows only in `groups[]` - linking `EZTEXTING-API.md` and `BUCKETS.md`; the old plan to History.
- "Resending after an outage" keeps what the command takes and how it sends (code comments quote it); when and how to run it handed to `DEPLOY.md` under the same name; the production run of 2026-10-16 and task 27's other two failures to History.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
