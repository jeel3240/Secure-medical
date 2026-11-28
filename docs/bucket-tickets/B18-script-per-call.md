# B18 · The script per call

**Goal:** a robot call's script - its words and the transfer's ring - is the one of the call's own bucket, and a bucket with no robot script (every new bucket, Jeel 2026-11-27) gets none, never antibiotics'.

**Why:** today every lookup is "the active script" (`loadActiveCallScript`,
`backend/src/db/call-script.ts`), read fresh on every `/auto/*` webhook, and again in
`backend/src/db/lead-texts.ts` (the link), `backend/src/db/auto-calls.ts`
(`transferContext`, the `scripted` check) and the relay's `callSettings()`
(`backend/src/ai/relay-store.ts`, which already knows the call). With two buckets, a
weight-loss call would speak antibiotics' words.

**Depends on:** B08, B15 · **Size:** M · **Status:** To do · **Deploy note:** a
migration that only drops an index, after the code stops relying on it.

## Build

- `db/call-script.ts`:
  - `loadScriptForCall(q, callId)` - the call's conversation, its flow's bucket, that bucket's active script, or `null` when the bucket has none;
  - `loadBucketScript(q, bucketId)`;
  - `loadActiveCallScript` removed.
- `backend/src/api/twilio-webhooks.ts`: the `loadScript` dependency takes the call;
  every route that loads a script passes the call it is answering - `/auto/answer`,
  `/auto/gather`, `/auto/ai-after`, `/auto/amd`, `/auto/after`, `/auto/hold`,
  `/auto/offer`.
- `db/lead-texts.ts`: `sendCallLinkText(leadId, callId)` - the call's script's link
  text, not a fresh `WHERE is_active`.
- `db/auto-calls.ts`: `transferContext` - the call's script's first step;
  `startAutomatedCall`'s `scripted` check - the conversation's bucket has an active
  script.
- `ai/relay-store.ts`: `callSettings(callId)`; `ai/relay.ts` passes the call it has.
- Admin > Configuration keeps showing the one bucket's script (`onlyBucket`) until B31.
- A migration dropping `call_scripts_one_active`.

## Done when

- [ ] `scripts/auto-calls-live-check.ts` (or a new `script-per-call-live-check.ts`):
      two buckets, each with an active script - a call on bucket B's conversation gets
      B's first question, B's link text and B's voicemail line; a call on A's gets A's.
- [ ] `scripts/call-script-live-check.ts`: one active script per bucket; two active in
      two buckets allowed.
- [ ] `src/api/__tests__/auto-call-webhooks.test.ts`: every route asks for the script
      of the call it is handling.
- [ ] `src/ai/relay.test.ts`: `callSettings` asked with the call.
- [ ] `scripts/lead-texts-live-check.ts`: the link is the call's script's.
- [ ] `npm run e2e` passes (one bucket, unchanged words).

## Tests

The live checks, the route and relay unit tests, the e2e.

## Docs to update in the same commit

`docs/AUTO-CALL-SCRIPT.md` ("The script"), `docs/AUTO-CALLS.md` ("How a call is placed"), `docs/AI-AGENT.md` (her
stop line and words come from the call's script), `docs/SCHEMA.md` (the dropped
index), `docs/WORKFLOW.md`, `docs/BUCKETS.md`.

## Not in this ticket

The dialler's per-bucket robot switch (B34); Admin's picker (B31).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
