# B41 · Seri's health per bucket

**Goal:** one bucket's Seri falling back holds back only that bucket's calls; OpenAI
being down holds back only the buckets that have her on.

**Why:** `BUCKETS.md`: a problem with one bucket's Seri stops only that bucket's. Today
`fallbackStreak` (`backend/src/ai/health.ts`) counts Seri's last three calls across the
whole app, and the dialler asks `seriReady` once per look and stops everything
(`worker/auto-calls.ts`).

**Depends on:** B15, B35 · **Size:** S · **Status:** Waits on A22 (via B35) · **Deploy
note:** none.

## Build

- `ai/health.ts`: `fallbackStreak(bucketId)` - the last three Seri calls of that
  bucket; `seriState(bucketId)` - off, paused for fallbacks, or OpenAI down (the
  OpenAI probe stays shared and cached as today).
- `worker/auto-calls.ts` and `db/auto-dial.ts`: the buckets that have Seri on but are
  not ready are left out of `leadsToCall`; the rest of the look goes on. The stop
  reason names the bucket (`bucketId`) when one is held back.

## Done when

- [ ] `scripts/ai-agent-live-check.ts`: three fallbacks in bucket A pause A, not B.
- [ ] `src/worker/auto-calls.test.ts`: A held back, B called; OpenAI down - only the
      buckets with Seri on held back.
- [ ] `src/ai/health.test.ts`: per bucket.

## Tests

As above.

## Docs to update in the same commit

`docs/AI-AGENT.md` (A17's section), `docs/AUTO-CALLS.md` (the stop reasons),
`docs/LOGGING.md`, `docs/BUCKETS.md`.

## Not in this ticket

Anything about OpenAI itself.

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
