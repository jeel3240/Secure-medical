# D37 · AUTO-CALL-TRANSFER.md

**Goal:** Who is free, the switch, the transfer, the hold line, offers to the next person free, and a lead calling back - in their own area doc.

**Why:** As D36. It also names `takeCallWithLead` (`db/claims.ts`) and `closeFromTwilio` correctly, which the old text does not (audit, 2026-11-27).

**Depends on:** D35 · **Size:** M · **Status:** Done 2026-11-27 - `docs/AUTO-CALL-TRANSFER.md`, about 510 lines; `docs-check --type area` passes · **Deploy note:** none - documentation only.

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

- From "Who is free" (split into "Who is free", "The "Taking calls" switch", "Letting a transfer ring out turns it off", "The app is open"), "The transfer", "The hold line", "The next person who comes free gets the waiting lead" and "A lead calling back" - each name kept.
- `takeTransfer` is named as built on `takeCallWithLead` (`db/claims.ts`), shared with `takeIncomingCall`; the hold watcher's close as `closeFromTwilio` (`api/left-open.ts`). `FREE_SQL`'s parts named as the code has them (`ON_A_CALL_SQL`, `CALL_UNDER_WAY_HOURS`).
- The frontend rewriter's handoff merged: the browser's own parts ("In the browser", the switch in the app bar) and three test rows. Facts `INCOMING-CALLS.md` owns - the ring markers' handling, the call-back card - are links, per the twilio rewriter's handoff.
- Over 500 lines with the browser's parts; under the 600 limit. The "Who is free" and "The hold line" comments (about 34) are listed in `renames.from-robot.md`.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
