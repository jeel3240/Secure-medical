# B49 · Second bucket: Seri

**Goal:** Seri runs the second bucket's calls with its own pack, switched on only after
her answers pass their tests and real calls.

**Why:** `BUCKETS.md`: a new bucket's Seri is copy, edit, test, then switch on.

**Depends on:** B48 · **Size:** M · **Status:** Waits on the client's content ·
**Deploy note:** the pack ships compiled; the switch stays off until the end.

## Build

- Its pack, from the client's approved content: the campaign, answers, products,
  playbook - checked by the loader; registered; `knowledge_key` set by a migration.
- Its eval cases (B42); both evals run until they pass at the bar Phase 7 set
  (`AI-AGENT.md`).
- Calls on the dev number through the A34 checklist that apply to it.
- Then her switch on for that bucket in production, and the first calls checked, as
  A22.

## Done when

- [ ] The loader accepts the pack; the evals' scores in *As built*.
- [ ] The dev calls, recorded.
- [ ] Her switch on in production; the first real calls checked.

## Tests

As above.

## Docs to update in the same commit

`docs/AI-AGENT.md` (the new pack), `docs/BUCKETS.md`.

## Not in this ticket

A third bucket.

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
