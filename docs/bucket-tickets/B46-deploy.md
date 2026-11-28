# B46 · Deploy, the switch-over watched

**Goal:** Phase 8 Part 1 reaches production with the antibiotics bucket working
exactly as before, and the switch-over watched.

**Why:** the switch-over moves every contact in the live antibiotics group; it is done
once, on the client's account, so it is watched, as A22 was for Seri.

**Depends on:** B45 · **Size:** S · **Status:** To do · **Deploy note:** this is the
deploy.

## Build

A runbook in this ticket, filled in as it is done:

- which migrations are new on production, from `schema_migrations`;
- B02's order: build, migrate, then `up -d`;
- B13's columns drop only in a deploy after B11's, B14's and B23's - checked;
- the client's OK for the "- taken" group, on record;
- watched: `bucket.switched_over` - the counts moved and taken in; the Antibiotics
  group empty of old contacts; the first new lead taken in, texted and moved; health
  green; the queue and Admin > Leads as before;
- `EZT_GROUP` removed from the server's `.env` once the switch-over is done;
- no second bucket row until the gate is met (the tracker).

## Done when

- [ ] Each runbook line ticked with its date and what was seen.

## Tests

What production shows, recorded.

## Docs to update in the same commit

This ticket; `CLAUDE.md` (§10 Phase 8 row, "Deploy" note); `docs/WORKFLOW.md`
("Where the files stand"); `docs/BUCKETS.md`.

## Not in this ticket

The second bucket (B47-B49).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
