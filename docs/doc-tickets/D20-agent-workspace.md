# D20 · AGENT-WORKSPACE.md

**Goal:** `AGENT-WORKSPACE.md` in the Area template: claim, the holder rule, the card, read, notes, outcomes, agent texts.

**Why:** 731 lines with about 55 dates and three struck-through items; rules 2b and 2d restated from `STATE-MACHINE.md`; the DNC block paths listed in four docs (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** Done 2026-11-27 - `docs/AGENT-WORKSPACE.md` in the Area sections (477 lines, was 731), docs check passes · **Deploy note:** none - documentation only.

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

- `AGENT-WORKSPACE.md` rewritten: Endpoints, Claim and release, Every write needs the lead to be yours, The lead card, Marking a lead read, Notes, Dispositions (Closing a lead), Blocking a number, Agent SMS, and one-line pointers for Callbacks and The timeline; Rules numbered 1-11.
- "Blocking a number" owns the four paths through `db/dnc.ts` (`DNC_REASONS`: `sms_stop`, `ezt_opt_out`, `agent_disposition`, `call_opt_out` - Seri's stop included) and the release; `WEBHOOKS.md`, `POLLER.md` asked by handoff to link it; `ADMIN.md` links it.
- Rules 2b and 2d linked to `STATE-MACHINE.md`; the card keeps its own badge words. Check counts dropped; "What it needed that did not exist" is a 2026-09-26 History line.
- Callbacks went to `CALLBACKS.md` (D21) and the timeline to `TIMELINE.md` (D22).

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
