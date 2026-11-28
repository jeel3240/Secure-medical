# D37 · AUTO-CALL-TRANSFER.md

**Goal:** Who is free, the switch, the transfer, the hold line, offers to the next person free, and a lead calling back - in their own area doc.

**Why:** As D36. It also names `takeCallWithLead` (`db/claims.ts`) and `closeFromTwilio` correctly, which the old text does not (audit, 2026-11-27).

**Depends on:** D35 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- `docs/AUTO-CALL-TRANSFER.md` in the Area template; the presence facts owned here, `TWILIO.md` links; 113 code comments quote `AUTO-CALLS.md "<section>"`: keep each section's name where it can stay, and update the comments where it cannot - the list in *As built*.

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

as D36.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
