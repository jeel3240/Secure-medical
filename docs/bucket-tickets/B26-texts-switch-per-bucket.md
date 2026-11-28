# B26 · Texts switch per bucket

**Goal:** each bucket's texts can be switched off and on. While off, its group is left
alone; switching on texts everyone who waited.

**Why:** a new bucket starts with everything off (`BUCKETS.md`, "What each bucket
has"); decision of 2026-11-27: switching on texts everyone waiting, however long ago
they arrived ("Switching a bucket on").

**Depends on:** B24 · **Size:** S · **Status:** Waits on the client's OK for two
groups · **Deploy note:** additive; outside the robot's hours until B02 is in.

## Build

- **Migration:** `buckets.texts_on BOOLEAN NOT NULL DEFAULT false`; antibiotics `true`.
- `pollOnce`: a bucket with texts off is not read - people wait in its group.
- The opener retry and the resend (`db/openers-never-sent.ts`,
  `worker/send-waiting-openers.ts`): never a conversation of a bucket with texts off.
- `backend/src/db/buckets.ts`, `switchTexts(bucketId, on, by)`: under an advisory lock,
  a no-op when unchanged, otherwise the update and `bucket.switched` (`which: 'texts'`,
  `from`, `to`, `via`, the actor for the website) in one transaction - the model is
  `switchAiAgent` (`ai/settings.ts`).
- `npm run bucket -- texts <key> on|off`, as `npm run ai-agent` does - added to the
  `bucket` command (B21; created here if B21 is not built yet). The Admin button is
  B32.

## Done when

- [ ] `scripts/poller-live-check.ts`: an off bucket's group not read; switched on, the
      next read texts everyone waiting, the oldest included.
- [ ] `scripts/retry-openers-live-check.ts`: an off bucket's failed opener not
      retried.
- [ ] `scripts/activity-live-check.ts`: `bucket.switched` recorded, not when unchanged.
- [ ] A unit test for the command's arguments.

## Tests

The live checks and the unit test.

## Docs to update in the same commit

`docs/POLLER.md`, `docs/AUDIT.md`, `docs/LOGGING.md`, `docs/SCHEMA.md`, `docs/WORKFLOW.md`, `docs/BUCKETS.md`.

## Not in this ticket

The Admin button (B32).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
