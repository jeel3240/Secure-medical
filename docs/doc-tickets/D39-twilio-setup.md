# D39 · TWILIO-SETUP.md

**Goal:** What the Twilio account needs, its settings, the `twilio:configure` guard, testing on the dev number and deploying calling - one how-to.

**Why:** How-to steps inside an area doc (audit, 2026-11-27).

**Depends on:** D38, D06, D08 · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- `docs/TWILIO-SETUP.md` (How-to); the variables linked to `ENVIRONMENT.md`; the production-number rule stated once, linked from CLAUDE.md.

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

`docs/README.md`, `TWILIO.md`, `CLAUDE.md`'s pointer.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
