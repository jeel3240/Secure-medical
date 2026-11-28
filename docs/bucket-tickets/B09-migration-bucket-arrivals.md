# B09 · Migration: bucket arrivals

**Goal:** every time a person is taken into a bucket, one add-only row says so -
starting with today's poller and every lead already in the database.

**Why:** `BUCKETS.md`, "The database": `bucket_arrivals` is where "which buckets is
this person in, and since when" lives. Today a known phone is skipped and leaves no
trace.

**Depends on:** B07 · **Size:** M · **Status:** To do · **Deploy note:** additive;
deploy outside the robot's hours until B02 is in.

## Build

- **Migration** (the next free number):
  - `bucket_arrivals`: `id BIGSERIAL`, `lead_id` and `bucket_id` (NOT NULL foreign
    keys), `arrived_at TIMESTAMPTZ NOT NULL DEFAULT now()` (when we took them in),
    `ezt_added_at` (the contact's `createdAt`), `source`, `result` (named check:
    `started`, `held`, `blocked`, `wrong_number`, `mid_flow`), `conversation_id`
    (foreign key, nullable), `moved_at TIMESTAMPTZ` (empty until B24 moves them);
  - checks: `started` has a conversation;
  - a unique index: one arrival with `moved_at IS NULL` per `(lead_id, bucket_id)`;
  - an index on `(lead_id, arrived_at DESC)` for "the newest arrival" (B11);
  - add-only: a trigger refuses `DELETE`, and any `UPDATE` except filling an empty
    `moved_at`, once (`refuse_change()` from 006 is the model);
  - **backfill**: one arrival per existing lead - the antibiotics bucket;
    `arrived_at = COALESCE(leads.ezt_added_at, leads.created_at)`, so every lead's
    "Received" stays exactly what it is today (B11); `ezt_added_at` and `source` from
    the lead; `result` `started` with its first conversation, or `blocked` when that
    conversation is `suppressed`. A lead with no conversation (scripts only) gets no
    arrival - B11 keeps the fallback to `leads.created_at`. A guard: the migration
    stops unless every lead with a conversation got exactly one arrival.
- `backend/src/db/arrivals.ts` (new): `recordArrival(client, entry)`.
- `worker/poller.ts`, `insertLead`: writes the new lead's arrival in its transaction -
  `started`, or `blocked` for a suppressed lead.

## Done when

- [ ] `scripts/arrivals-live-check.ts`: the poller's new lead gets one arrival; the
      checks and the unique index refuse what they should (named); an update other
      than filling `moved_at` refused; a delete refused; `moved_at` filled once, not
      twice.
- [ ] `scripts/arrivals-upgrade-check.ts` (B03): leads seeded in the old shape - with
      and without `ezt_added_at`, suppressed, a lead with two conversations (dev) -
      each gets the right arrival; `arrived_at` equals today's "Received".
- [ ] `src/worker/poller.test.ts`: the arrival is written in the lead's transaction.

## Tests

The live check, the upgrade check, the poller unit test.

## Docs to update in the same commit

`docs/SCHEMA.md` (the table, its trigger and indexes), `CLAUDE.md` §5,
`docs/WORKFLOW.md`, `docs/AUDIT.md` (arrivals are an add-only record),
`docs/POLLER.md` (the arrival is written), `docs/BUCKETS.md`.

## Not in this ticket

Reading arrivals (B11, B12); arrivals with any result but `started` and `blocked`
(B23); moving people (B24).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
