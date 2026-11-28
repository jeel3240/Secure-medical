# B34 · Calls per bucket

**Goal:** the dialler calls only leads whose bucket has calls switched on and someone to
answer them - Seri on, or a robot script - checked by the dialler and again under the
lock; and a bucket switched on later does not crowd out new leads.

**Why:** Jeel, 2026-11-27: new buckets have no robot script - their calls are Seri's
(`BUCKETS.md`, "What follows the lead's bucket"). A new bucket starts with calls off.
Today the dialler has no bucket check (`backend/src/db/auto-dial.ts`), and
`startAutomatedCall` (`backend/src/db/auto-calls.ts`) refuses only when no script is
active anywhere. And T27's "new leads first" uses one global switch-on time: switching
on a second bucket's calls would make everyone already waiting in it count as new and
take the room ahead of antibiotics' fresh leads (review, 2026-11-27).

**Depends on:** B17 · **Size:** M · **Status:** To do · **Deploy note:** additive;
outside the robot's hours until B02 is in.

## Build

- **Migration:** `buckets.calls_on BOOLEAN NOT NULL DEFAULT false` (antibiotics `true`)
  and `buckets.calls_since TIMESTAMPTZ` (antibiotics: the current `auto_calls_since`).
- `leadsToCall` / `stillDue`: only conversations whose bucket has calls on **and** can
  be answered - its Seri switch on (and ready, once B41 is in), or an active robot
  script; T27's order on `c.created_at > GREATEST(auto_calls_since, calls_since)`.
  A bucket with no script and Seri off places nothing - and while OpenAI is down the
  dialler waits, as it does today (A17).
- `dialRoom`'s `scripted`: some bucket with calls on can be answered.
- `startAutomatedCall`, under the lead's lock: refuses with `bucket_off` (calls off) or
  `no_caller` (no Seri and no script) - written as `call.refused` like the other
  refusals.
- `backend/src/db/buckets.ts`, `switchCalls(bucketId, on, by)`: as `switchTexts` (B26) -
  lock, no-op when unchanged, `bucket.switched` (`which: 'calls'`); on switch-on,
  `calls_since` set to now.
- `npm run bucket -- calls <key> on|off` - added to the `bucket` command, created here
  if B21 and B26 are not built yet (`backend/src/cli/bucket.ts`).
- `AUTO_CALLS` stays the master switch for the whole app.

## Done when

- [ ] `scripts/auto-dial-live-check.ts`: a bucket with calls off - none of its leads
      picked; calls on, no script and Seri off - none; calls on with Seri on - picked;
      antibiotics with its script and Seri off - picked, as today; the T27 order with a
      bucket switched on later - its waiting leads after the other bucket's new ones.
- [ ] `scripts/auto-calls-live-check.ts`: `bucket_off` and `no_caller` refused under
      the lock, recorded.
- [ ] `scripts/activity-live-check.ts`: `bucket.switched` for calls.

## Tests

The live checks.

## Docs to update in the same commit

`docs/AUTO-CALLS.md` ("Who is called", T27's note, the refusals), `docs/AUDIT.md`,
`docs/SCHEMA.md`, `docs/WORKFLOW.md`, `docs/BUCKETS.md`.

## Not in this ticket

The Admin button (B32); Seri's own switch (B35); what happens when Seri fails mid-call
on a bucket with no script (B51).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
