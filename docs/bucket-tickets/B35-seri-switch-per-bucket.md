# B35 · Seri's switch per bucket

**Goal:** Seri is switched on and off per bucket; a call goes to her only when its own
bucket's switch is on.

**Why:** `BUCKETS.md`, "Seri with several buckets": each bucket has its own Seri
switch; a new bucket's Seri is switched on only after its answers pass testing. Today
it is one `settings.ai_agent` row, read by `/auto/answer` (`ai/answer.ts`), the
dialler's gate (`worker/index.ts`), Admin and the command.

**Depends on:** B15, A22 · **Size:** M · **Status:** Waits on A22 - Seri's first
production calls checked · **Deploy note:** the code reads a column its migration
adds - outside the robot's hours until B02 is in.

## Build

- **Migration:** `buckets.ai_agent_on BOOLEAN NOT NULL DEFAULT false`; antibiotics'
  copied from `settings.ai_agent` (`on` is true); the `ai_agent` settings row deleted -
  a guard first: it stops unless the copy matches.
- `backend/src/ai/settings.ts`: `readAiAgentSwitch(bucketId)`,
  `readAiAgentOn(bucketId)` (the switch and the key), `switchAiAgent(pool, bucketId,
  to, by)` - `ai_agent.switched`'s `detail` gains `bucketId`.
- `backend/src/ai/answer.ts`, `seriGreeting`: the answered call's bucket's switch.
- The dialler's gate (`worker/index.ts`, `worker/auto-calls.ts`): Seri's readiness
  asked per bucket that has her on - B41 makes her health per bucket; here only the
  switch.
- On a bucket with no robot script, Seri off means no calls at all (B34): the confirm
  dialog and the command both say so.
- `backend/src/cli/ai-agent.ts`: `npm run ai-agent -- <bucket key> on|off`; an unknown
  key lists the buckets.
- `backend/src/api/admin/config.ts`: `POST /buckets/:key/ai-agent` in place of
  `POST /ai-agent`, the same refusals (`no_key`), and `no_pack` for a bucket with no
  knowledge pack once B36 is in; `frontend/src/api/admin.ts` and the Seri card call it
  for the picked bucket.

## Done when

- [ ] `scripts/ai-agent-live-check.ts`: two buckets, Seri on in one - an answered call
      in that bucket goes to her, in the other to the script.
- [ ] `scripts/ai-switch-upgrade-check.ts` (B03): `on` and `off` copied; the row gone;
      a mismatch stops the migration.
- [ ] `src/ai/settings.test.ts`, `src/api/__tests__/admin-screens.test.ts`,
      `auto-call-webhooks.test.ts`, `frontend/src/pages/admin/ConfigSeri.test.tsx`:
      per bucket.
- [ ] `scripts/activity-live-check.ts`: `bucketId` in the record.
- [ ] `npm run e2e`: Seri's steps pass with the antibiotics switch.

## Tests

As above.

## Docs to update in the same commit

`docs/AI-AGENT.md` (section 7, the switch), `docs/ADMIN.md`, `docs/AUDIT.md`,
`docs/DEPLOY.md` ("Seri, the AI agent": the command now takes a bucket), `docs/SCHEMA.md`, `docs/WORKFLOW.md` ("Where the files stand"), `docs/BUCKETS.md`.

## Not in this ticket

Her knowledge per bucket (B36-B40); her health per bucket (B41).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
