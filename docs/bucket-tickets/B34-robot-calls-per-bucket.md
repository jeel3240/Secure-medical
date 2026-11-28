# B34 · Robot calls per bucket

**Goal:** the robot calls only leads whose bucket has robot calls switched on and an
active script - checked by the dialler and again under the lock - and a bucket switched
on later does not crowd out new leads.

**Why:** `BUCKETS.md`: a new bucket starts with robot calls off. Today the dialler has
no bucket check (`backend/src/db/auto-dial.ts`), and `startAutomatedCall`
(`backend/src/db/auto-calls.ts`) refuses only when no script is active anywhere. And
T27's "new leads first" uses one global switch-on time: switching on a second bucket's
calls would make everyone already waiting in it count as new and take the room ahead of
antibiotics' fresh leads (review, 2026-11-27).

**Depends on:** B17 · **Size:** M · **Status:** To do · **Deploy note:** additive;
outside the robot's hours until B02 is in.

## Build

- **Migration:** `buckets.robot_calls_on BOOLEAN NOT NULL DEFAULT false` (antibiotics
  `true`) and `buckets.robot_calls_since TIMESTAMPTZ` (antibiotics: the current
  `auto_calls_since`).
- `leadsToCall` / `stillDue`: only conversations whose bucket has robot calls on and an
  active script; T27's order on `c.created_at > GREATEST(auto_calls_since,
  robot_calls_since)`.
- `dialRoom`'s `scripted`: some bucket with robot calls on has an active script.
- `startAutomatedCall`, under the lead's lock: refuses with `bucket_off` or `no_script`
  when the conversation's bucket fails either - written as `call.refused` like the
  other refusals.
- `backend/src/db/buckets.ts`, `switchRobotCalls(bucketId, on, by)`: as `switchTexts`
  (B26) - lock, no-op when unchanged, `bucket.switched` (`which: 'robot_calls'`); on
  switch-on, `robot_calls_since` set to now.
- `npm run bucket -- robot-calls <key> on|off` - added to the `bucket` command,
  created here if B21 and B26 are not built yet (`backend/src/cli/bucket.ts`).
- `AUTO_CALLS` stays the master switch for the whole app.

## Done when

- [ ] `scripts/auto-dial-live-check.ts`: a bucket with robot calls off - none of its
      leads picked; on but no script - none; the T27 order with a bucket switched on
      later - its waiting leads after the other bucket's new ones.
- [ ] `scripts/auto-calls-live-check.ts`: `bucket_off` and `no_script` refused under
      the lock, recorded.
- [ ] `scripts/activity-live-check.ts`: `bucket.switched` for robot calls.

## Tests

The live checks.

## Docs to update in the same commit

`docs/AUTO-CALLS.md` ("Who is called", T27's note, the refusals), `docs/AUDIT.md`,
`docs/SCHEMA.md`, `CLAUDE.md` §5, `docs/WORKFLOW.md`, `docs/BUCKETS.md`.

## Not in this ticket

The Admin button (B32).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
