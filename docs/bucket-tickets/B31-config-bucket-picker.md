# B31 · Admin > Configuration: a bucket picker

**Goal:** a superadmin picks a bucket at the top of Admin > Configuration, and the
Texts, Scoring and Calls tabs show that bucket's flow, script, missed-call text and
Seri switch.

**Why:** `BUCKETS.md`, "What changes in the code". Until now the page shows the one
bucket (`onlyBucket`, B08, B18).

**Depends on:** B08, B18, B33, B35 · **Size:** M · **Status:** To do · **Deploy
note:** none.

## Build

- `backend/src/db/admin-config.ts`: `getAdminConfig(bucketId)` - everything per bucket
  that is per bucket (the flow and its scoring, the robot script if it has one, the missed-call text,
  Seri's switch); the shared parts unchanged (the tiers, the robot's hours and limits);
  the list of buckets.
- `backend/src/api/admin/config.ts`: `?bucket=<key>`, checked - 400 `invalid_bucket`;
  no `bucket` means the first.
- `frontend/src/pages/admin/ConfigPage.tsx`: the picker at the top, kept in the
  address (`?bucket=`) beside `?tab=`, shown only with more than one bucket; each
  card's heading names the bucket where it is per bucket.

## Done when

- [ ] `scripts/admin-live-check.ts`: two buckets - each one's flow, script, missed-call
      text and switch; the shared parts the same.
- [ ] Route test: `invalid_bucket`.
- [ ] `frontend/src/pages/admin/ConfigPage.test.ts` and `ConfigSeri.test.tsx`: the
      picker hidden with one bucket; switching bucket changes every per-bucket card.

## Tests

As above.

## Docs to update in the same commit

`docs/ADMIN.md` (Configuration), `docs/FRONTEND.md`, `docs/BUCKETS.md`.

## Not in this ticket

Switches for texts and calls (B32); editing anything (Part 3).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
