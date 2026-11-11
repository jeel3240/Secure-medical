# A21 · Every path on a real phone

**Goal:** Jeel hears every path on the dev number before anything reaches production.

**Why:** Decided by Jeel: test as much as possible before launch, then switch everything on.

**Depends on:** A20  ·  **Size:** Medium (about a day)

## Build

- Checklist, each on the dev number (480) 530-8582 to our own phones:
  - yes, now (transfer, own agent, everyone, hold, busy)
  - yes, later (call back booked, appears when due)
  - no, then link; two no's
  - every playbook objection
  - a question Seri cannot answer (specialist, never "I don't know")
  - price and medical questions (no price, no advice)
  - talking over Seri; saying "hmm" while she talks
  - silence; 3 minutes
  - stop
  - voicemail; hang-up mid-call
  - OpenAI key removed mid-call (falls back to the script); OpenAI down before calling (no calls)

## Done when

- [ ] Every line passed and noted with the date in `docs/AI-AGENT.md`, like T26.

## Tests

- This ticket is the test.

## Docs to update in the same commit

- `docs/AI-AGENT.md`.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
