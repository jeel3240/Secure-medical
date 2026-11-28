# B51 · Seri failing on a bucket with no script

**Goal:** when Seri fails during a call on a bucket with no robot script, she says one
goodbye line, the call ends, and the lead goes to the top of the agents' queue - no
script to fall back to.

**Why:** Jeel, 2026-11-27: new buckets have no robot script. Today when Seri fails
(OpenAI slow or failing mid-call), `/auto/ai-after` hands the live call to the
script's first question (`backend/src/ai/after.ts`, `AI-AGENT.md`, "Limits and
backups"). With no script, the lead must not be dropped - a person calls them instead.

**Depends on:** B15, B18, B35 · **Size:** S · **Status:** To do · **Deploy note:**
none - it acts only on a bucket with no script, and antibiotics has one.

## Build

- `backend/src/ai/after.ts` (`afterSeri`, the fallback branch): when the call's bucket
  has no active robot script -
  - one goodbye line, shared by every bucket, its words approved by Jeel in this
    ticket's PR (in the house style: short, no promise of a time);
  - the call ends;
  - a call back open to everyone, due now, through `bookAiCallback`
    (`backend/src/db/callbacks.ts`), its note saying Seri's call dropped - so the lead
    is first in the queue as a due call back (A16) and the first agent to pick them up
    takes it;
  - recorded as today: `ai_ended_with = 'fallback'`, with why.
- Antibiotics - a bucket with a script - is unchanged: the script takes over, as today.
- The goodbye line in `backend/src/ai/relay-messages.ts` beside the relay's other fixed
  lines.

## Done when

- [ ] `src/ai/after.test.ts`: no script - goodbye, end, call back due now; with a
      script - the script's first question, as today.
- [ ] `src/api/__tests__/auto-call-webhooks.test.ts`: `/auto/ai-after` on a
      script-less bucket's failed call.
- [ ] `scripts/ai-agent-live-check.ts`: the call back written, open to everyone, due
      now, with its note; the fallback recorded.
- [ ] `npm run e2e` (B43): OpenAI failing mid-call on the test bucket.

## Tests

As above.

## Docs to update in the same commit

`docs/AI-AGENT.md` ("6. Limits and backups"), `docs/CALLBACKS.md` ("Seri's call
backs"), `docs/QUEUE.md`, `docs/BUCKETS.md`.

## Not in this ticket

OpenAI down before a call - the dialler already waits (A17; per bucket, B41).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
