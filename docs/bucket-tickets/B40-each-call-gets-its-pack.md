# B40 · Each call gets its bucket's pack

**Goal:** when Seri takes a call, she is handed the pack of the call's bucket.

**Why:** until now the relay holds one pack for the process (`api/index.ts` passes it
to the relay; `ai/relay.ts`). With B36-B39 a pack carries everything per campaign; this
connects it to the call.

**Depends on:** B15, B36, B37, B38, B39 · **Size:** S · **Status:** To do · **Deploy
note:** none.

## Build

- `backend/src/ai/relay.ts`: when a call starts, the call's conversation, its bucket,
  its `knowledge_key`, then `pack(key)`; the brain for that call is built with that
  pack (`ai/brain.ts`). The relay no longer receives one pack at start-up - it
  receives the registry.
- `ai/relay-store.ts`, `startAiCall`: the key and version of that pack.
- `ai/answer.ts`: her greeting from that pack where it differs.
- A test pack (fixture only, never registered for production) to prove two packs.

## Done when

- [ ] `src/ai/relay.test.ts`: a call in bucket B gets B's pack, a call in A gets A's;
      the record says which.
- [ ] `scripts/ai-agent-live-check.ts`: the key and version saved per call.
- [ ] `npm run e2e`: Seri's steps pass.

## Tests

As above.

## Docs to update in the same commit

`docs/AI-AGENT.md` (sections 2-4: where her knowledge comes from),
`docs/BUCKETS.md`.

## Not in this ticket

Her health per bucket (B41).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
