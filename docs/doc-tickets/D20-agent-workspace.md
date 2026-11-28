# D20 · AGENT-WORKSPACE.md

**Goal:** `AGENT-WORKSPACE.md` in the Area template: claim, the holder rule, the card, read, notes, outcomes, agent texts.

**Why:** 731 lines with about 55 dates and three struck-through items; rules 2b and 2d restated from `STATE-MACHINE.md`; the DNC block paths listed in four docs (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History;
- rules 2b/2d linked; the DNC block paths owned here (every path through `db/dnc.ts`), linked from `WEBHOOKS.md`, `POLLER.md`, `ADMIN.md`;
- "What it needed that did not exist" to History; the check counts removed.
- Callbacks (D21) and the timeline (D22) leave in their own tickets.

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

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
