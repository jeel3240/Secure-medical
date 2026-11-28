# B47 · Second bucket: texts

**Goal:** the client's second bucket takes in and texts its own leads.

**Why:** the point of Phase 8.

**Depends on:** B46 and the client's content · **Size:** S · **Status:** Waits on the
client's content · **Deploy note:** a migration with new rows only.

## Build

Following "How to add a bucket" (B44):

- a migration: the bucket row; its flow - questions, choices, replies and points, the
  best answers reaching 100; its missed-call text and line; texts, calls and Seri off; its call lines (B50);
- its EZ Texting group set on the test account, then on production;
- a test contact on the test account walks the flow; then texts switched on in
  production from Admin.

## Done when

- [ ] The migration's live check: the flow as the client wrote it, word for word, and
      its guards.
- [ ] The test contact's walk, recorded.
- [ ] Texts on in production; the first real lead taken in, recorded.

## Tests

As above.

## Docs to update in the same commit

`docs/FLOWS.md` (the new flow), `docs/STATE-MACHINE.md` (its questions, if it adds
any path), `docs/SCHEMA.md`, `docs/WORKFLOW.md`, `docs/BUCKETS.md`.

## Not in this ticket

Its Seri and its calls (B49). It has no robot script (Jeel, 2026-11-27; B48 dropped).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
