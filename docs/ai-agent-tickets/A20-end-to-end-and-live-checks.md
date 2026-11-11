# A20 · End-to-end and live checks

**Goal:** `npm run e2e` and the live checks cover calls that go to Seri.

**Why:** The whole path, run in one go, before any real phone.

**Depends on:** A13, A14, A15, A16, A17, A18, A19  ·  **Size:** Medium (about a day)

## Build

- `backend/scripts/end-to-end.ts`: with Seri on and Twilio and OpenAI stubbed at their HTTP edge, run calls ending in each action, a fallback, and OpenAI down.
- `scripts/live-checks.sh` includes every new live check.

## Done when

- [ ] `npm run e2e` passes; every live check passes on a scratch database.

## Tests

- This ticket is the test.

## Docs to update in the same commit

- `docs/README.md` "How to test".

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
