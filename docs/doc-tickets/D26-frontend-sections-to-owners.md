# D26 · FRONTEND.md: the workspace and calling sections to their owners

**Goal:** What `FRONTEND.md` says about the workspace, incoming calls and "Taking calls" lives in those areas' docs.

**Why:** `FRONTEND.md` is 937 lines; most of it describes areas other docs own (audit, 2026-11-27).

**Depends on:** D20, D21, D22 · **Size:** M · **Status:** Done 2026-11-27 - the workspace, My Callbacks, timeline page, call bar, incoming card and Taking-calls browser parts handed to their six owners (`*.from-frontend.md`) · **Deploy note:** none - documentation only.

## Build

- the workspace sections to `AGENT-WORKSPACE.md` (and `CALLBACKS.md`, `TIMELINE.md`); incoming calls and "Taking calls" to `TWILIO.md`/`INCOMING-CALLS.md` and `AUTO-CALLS.md` - written in the receiving doc's template.

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

the receiving docs, `FRONTEND.md`.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

The workspace, My Callbacks, the Lead Timeline page, the call bar, the incoming card and the "Taking calls" switch's browser side went to `AGENT-WORKSPACE.md`, `CALLBACKS.md`, `TIMELINE.md`, `TWILIO.md`, `INCOMING-CALLS.md` and `AUTO-CALLS.md` as handoffs, each with its test rows, decisions and history; FRONTEND.md keeps only links. Fixed on the way: the old "Checked in the browser" list named Send SMS, removed 2026-09-29 (to History); the "!" hover reads "Not sent - EZ Texting did not accept it" (`Conversation.tsx`).

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
