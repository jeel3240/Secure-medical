# D43 · AI-AGENT.md, what remains

**Goal:** `AI-AGENT.md` is about 400 lines in the Area template: the call around Seri - answer, relay, after; who is there; her five actions; call backs; limits and fallback; the line dropping.

**Why:** "The seven decisions" has 8 rows; "about 3,500 words of instructions" describes the removed brain; "22 tickets" (34); two live-check counts disagree; `Caddyfile` for `caddy/Caddyfile` (audit, 2026-11-27).

**Depends on:** D40, D41, D42 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History, with a Status line in the fixed words;
- the stale points fixed; the "Build tracker" section dropped (the tracker is the tracker); repeated facts linked (`AUTO-CALLS.md`, `QUEUE.md`, `CALLBACKS.md`, `STATE-MACHINE.md`, `SCHEMA.md`, `AUDIT.md`, `DEPLOY.md`); the code comments naming removed code (`ai/actions.ts`, `ai/openai.ts`) corrected.

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
