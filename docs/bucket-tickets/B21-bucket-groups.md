# B21 · Bucket groups

**Goal:** each bucket knows its main EZ Texting group and its "- taken" group by id
and name; antibiotics' is filled in by itself from `EZT_GROUP`, once.

**Why:** `BUCKETS.md`, "Finding people" and decision 8 (Jeel, 2026-11-27: the taken
group is created by the app, once per bucket). A migration cannot read `.env`, and
dev and production use different groups. EZ Texting ignores `filters[groupId]`
(`EZTEXTING-API.md`), so the poller filters by name - a renamed group must be noticed,
not silently read as empty.

**Depends on:** B07, B20 · **Size:** M · **Status:** Waits on the client's OK for two
groups · **Deploy note:** additive; outside the robot's hours until B02 is in.

## Build

- **Migration:** on `buckets`, `ezt_group_id`, `ezt_group_name`, `ezt_taken_group_id`,
  `ezt_taken_group_name` - nullable until set, each unique.
- `backend/src/db/buckets.ts`:
  - `fillGroupsFromEnv()` - at the worker's start, for the antibiotics bucket only and
    only while its main group is empty: the name from `EZT_GROUP`, the id from
    `listGroups()` by exact name; recorded as `bucket.group_set`. A missing group logs
    an error and leaves it empty - intake for that bucket waits;
  - `ensureTakenGroup(bucket)` - the "<main group> - taken" group by exact name, or
    created through `createGroup`, once; recorded as `bucket.taken_group_created`.
    Called only by the switch-over (B25), so nothing is created on the client's
    account before its OK;
  - `setGroup(bucketId, name, by)` and the command `npm run bucket -- group <key>
    "<group name>"` - for any bucket, on each environment, since dev and production
    use different groups and a migration cannot know them: the id looked up by exact
    name; refused when the group is not found; recorded as `bucket.group_set`. This
    creates the `npm run bucket` command (`backend/src/cli/bucket.ts`), which B26 and
    B34 extend - whichever is built first creates it;
  - `checkGroupNames()` - at the start of each cycle, one `listGroups()`: a group
    whose id now carries a new name gets the new name, recorded as
    `bucket.group_renamed`; a group whose id is gone marks that bucket's intake
    stopped.
- `backend/src/db/health.ts`: per bucket, "group found" - degraded when a group is
  missing.
- `core/activity.ts`: the three actions, each with its `detail` documented.

## Done when

- [ ] `scripts/buckets-live-check.ts`: the group filled from the environment once, and
      not again; a rename followed and recorded; a missing group shows in health; the
      unique constraints.
- [ ] Unit tests for the functions with the client mocked: the name matched exactly
      (not `like`); `createGroup` called only when the taken group is missing; the
      command's arguments and its refusal for an unknown group.
- [ ] `scripts/activity-live-check.ts`: the three actions recorded.

## Tests

The live checks and unit tests.

## Docs to update in the same commit

`docs/SCHEMA.md`, `CLAUDE.md` §5, `docs/WORKFLOW.md`, `docs/AUDIT.md` (three actions),
`docs/LOGGING.md`, `docs/POLLER.md` (where the group comes from), `docs/BUCKETS.md`.

## Not in this ticket

Reading by membership (B24); the switch-over (B25); retiring `EZT_GROUP` (B25).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
