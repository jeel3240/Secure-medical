# D30 · DESIGN-PROMPT.md's notes to their owners

**Goal:** Every fact in `DESIGN-PROMPT.md`'s 61 notes lives in the doc that owns it.

**Why:** The brief is frozen (`DOCS.md`, "Brief"); its notes are the app's record, in the wrong place (audit, 2026-11-27).

**Depends on:** D29 · **Size:** S · **Status:** Done 2026-11-27 - every note's fact linked to its owner, handed off, or a row of FRONTEND.md's "Differences from the brief" · **Deploy note:** none - documentation only.

## Build

- each note's fact to its owner (queue notes to `QUEUE.md`, read-only admin to `ADMIN.md`...); gaps nobody owns - no toasts, no shortcuts, a spinner not a skeleton, no "Assign to", no draft save, Settings not built - into `FRONTEND.md`'s "Differences from the brief".

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

the owners, `FRONTEND.md`.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

About 60 notes: those the owners already had are linked (QUEUE, ADMIN, ADMIN-LEADS, AGENT-WORKSPACE, TWILIO, STATE-MACHINE); the screen facts they lacked are handoffs (QUEUE, AGENT-WORKSPACE, CALLBACKS, TIMELINE, AUTH); the gaps nobody owns - no toasts, no shortcuts, a spinner not a skeleton, no "Assign to", no draft save, Settings not built, no phone-frame preview, no hover icons, no row animation - are rows of FRONTEND.md's "Differences from the brief". `SEGMENT_LIMIT` (160, `core/messages.ts`) checked for the Settings row.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
