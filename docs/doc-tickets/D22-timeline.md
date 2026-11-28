# D22 · TIMELINE.md

**Goal:** The lead timeline - its sources, events and wordings - in its own Area doc.

**Why:** It is a separate part of the app, inside `AGENT-WORKSPACE.md` (audit, 2026-11-27); B12 changes it next.

**Depends on:** D20 · **Size:** S · **Status:** Done 2026-11-27 - `docs/TIMELINE.md` written, Area sections, docs check passes · **Deploy note:** none - documentation only.

## Build

- `docs/TIMELINE.md` from `AGENT-WORKSPACE.md`'s timeline section, in the Area template, naming `db/timeline.ts` and `components/Timeline.tsx`.

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

`docs/README.md`, `AGENT-WORKSPACE.md`, B12's ticket (its docs line).

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

- `docs/TIMELINE.md` (about 240 lines) names `db/timeline.ts` and `components/Timeline.tsx`: its sources and kinds, `TIMELINE_ACTIONS`, the system events, the order, and the words for messages, calls, the robot's call, Seri's part, callbacks and log entries.
- From the code: a `not_placed` robot call is left off; a call carries `agentId`; the reply's answer label (`detail.answer`) moved here from the lead card.
- Not done: system events from the newest conversation only (B12), Consent ref and State, Previous lead, the `callback.taken` wording.
- B12's docs line still names `AGENT-WORKSPACE.md`; the change is a handoff (the brief forbids editing other tickets).

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
