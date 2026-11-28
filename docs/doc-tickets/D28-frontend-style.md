# D28 · FRONTEND-STYLE.md

**Goal:** The frontend's design system - the type scale, tokens, shared classes, icons, `Segmented`, `DateTimeField` - in one reference doc.

**Why:** It is a third of `FRONTEND.md`, and `styles/type-system.test.ts` already enforces it (audit, 2026-11-27).

**Depends on:** D01 · **Size:** S · **Status:** Done 2026-11-27 - `docs/FRONTEND-STYLE.md`, every token value read from `frontend/src/styles/tokens.css`; docs check passes · **Deploy note:** none - documentation only.

## Build

- `docs/FRONTEND-STYLE.md` (Reference) from `FRONTEND.md`'s type system and shared-pieces sections, each value checked against `frontend/src/styles/tokens.css`.

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

`docs/README.md`, `FRONTEND.md`.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

`docs/FRONTEND-STYLE.md` (Reference): the type system, colour, space and layout tokens with their values, what `type-system.test.ts` enforces, the shared class names, the shared components (`Segmented`, `DateTimeField`, `RowMenu`) and the status-icon set, with the measurements and class renames in its History. The stylesheet count dropped; `--color-appbar-accent` found used only by the sign-in logo.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
