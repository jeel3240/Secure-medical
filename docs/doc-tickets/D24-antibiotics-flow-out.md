# D24 · The antibiotics flow out of STATE-MACHINE.md

**Goal:** The antibiotics flow's questions, choices and points live with flows, not with the rules.

**Why:** "The antibiotics flow" is a third of `STATE-MACHINE.md`; a flow is data (`FLOWS.md`), and Phase 8 adds more (audit, 2026-11-27).

**Depends on:** D23, D14 · **Size:** S · **Status:** Done 2026-11-27 - the flow is FLOWS.md, "The antibiotics flow", checked word for word against 012_flows.sql · **Deploy note:** none - documentation only.

## Build

- "The antibiotics flow" to `FLOWS.md` (a section per flow, or `docs/flows/antibiotics.md` if long), checked word for word against migration 012.

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

`FLOWS.md`, `STATE-MACHINE.md`, `docs/README.md`.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

- A section of `FLOWS.md` (about 90 lines), not `docs/flows/antibiotics.md`: questions, keys, positions, headings, choices, labels, points, replies, words, clarifications, the review text and the awards, each checked against `012_flows.sql` section 5; the path scores recomputed (55-100) and the segment lengths measured (158, 189, 243).
- Its decisions in `FLOWS.md`'s Decisions; "No to question 3" and the lines waiting for the client in its Not done; `SCHEMA.md` already links the new place, `CLAUDE.md` and `LEAD-FLOW.md` still name the old one (renames file).

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
