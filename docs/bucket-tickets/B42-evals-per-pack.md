# B42 · The evals per pack

**Goal:** the understand and speak test sets belong to a pack, so a new bucket's Seri
is measured on its own cases before her switch goes on.

**Why:** `backend/src/ai/evals/` (`speak-cases.ts`, `understand-cases.json`) pins
antibiotics' brand and answers. A new pack needs its own cases (`BUCKETS.md`: copy,
edit, **test**, then switch on).

**Depends on:** B37 · **Size:** S · **Status:** To do · **Deploy note:** none - tools
run by hand.

## Build

- The cases move under `backend/src/ai/evals/antibiotics/`, unchanged.
- `npm run ai:eval:speak -- <pack>` and `npm run ai:eval:understand -- <pack>`: run a
  pack's cases with that pack; a pack with no cases is refused, naming what is missing.
- The cases that test shared behaviour (a stop, talking over, silence) stay shared and
  run with every pack.

## Done when

- [ ] Both runners, run by hand on antibiotics: the same results as before the move -
      in *As built*.
- [ ] A unit test for the runner's arguments and the refusal.

## Tests

As above.

## Docs to update in the same commit

`docs/AI-AGENT.md` (the test sets), `docs/BUCKETS.md`.

## Not in this ticket

A second pack's cases (B49).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
