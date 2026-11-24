# A20 · End-to-end and live checks

**Goal:** `npm run e2e` and the live checks cover calls that go to Seri.

**Why:** The whole path, run in one go, before any real phone.

**Depends on:** A13, A14, A15, A16, A17, A18, A19  ·  **Size:** Medium (about a day)  ·  **Status:** Done 2026-11-12

## Build

- `backend/scripts/end-to-end.ts`: with Seri on and Twilio and OpenAI stubbed at their HTTP edge, run calls ending in each action, a fallback, and OpenAI down.
- `scripts/live-checks.sh` includes every new live check.

## Done when

- [x] `npm run e2e` passes - 131 checks, on the host and inside the api container as `docs/README.md` runs it; every live check passes on a scratch database - 23, each on its own.

## Tests

- This ticket is the test.

## Docs to update in the same commit

- `docs/README.md` "How to test".

## As built

- **Steps 14-19** of `backend/scripts/end-to-end.ts`, after the robot's three script calls and before the health check (now 20):
  - 14: Seri switched on (`switchAiAgent`); the worker's look wired with `seriReady` as `worker/index.ts` wires it - OpenAI's one-word check failing (503) places nothing (`openai_down`), then passing places Dana's call.
  - 15 Dana: `/auto/answer` connects her to Seri, "Hi, is this Dana?"; a question answered; a call back booked - `callback_booked`, `ai_booked` with her line and no agent, on the lead's page, the timeline (her conversation, how it ended) and Admin > Leads; not in the queue until due; due, first with the bold Callback tag; Maya picks Dana up and it is hers, on My Callbacks.
  - 16 Eli: a transfer - Maya's browser rings as a yes to the offer, nothing said again; she takes it; `transferred`.
  - 17 Fran: the link, texted once.
  - 18 Gil: "Stop calling me." - the stop line and `opt_out` without OpenAI asked; blocked, `call_opt_out`.
  - 19 Hal: OpenAI failing mid-call - `fallback`, `model_failed`; "Sorry about that." and the script's question; no, no: `not_interested`, her part `fallback`.
- **OpenAI at its HTTP edge:** a local server (`fakeOpenAi`) - streamed chunks as OpenAI sends them, words a piece at a time, then a tool call; a scripted failure; the one-word check up or down. Set with `OPENAI_BASE_URL` before any client exists.
- **The relay for real:** `attachRelay` on an `http.Server` around the same app; `Relay` opens the WebSocket as the TwiML says, signed for its address, and sends `setup` and the lead's words; Twilio's verdict (`human`) is posted first, as Twilio sends it in the first seconds, so her ending actions do not wait (A18).
- **Found on the way:** the stub's call ids (`CA0...1`, `CA0...2`, ...) reached the fixed ids the script gave agents' own calls (`CA0...8`, `CA0...9`) once Seri's five calls were added - the eighth robot call could not be saved. The fixed ones are letters now.
- **The api container was on an image from before Phase 7** (no `ws`): recreated (`docker compose up -d --no-deps api`), the worker left off; `docs/README.md` says so.
- **`live-checks.sh`** finds every `*-live-check.ts` by itself - no new file was needed: Seri's checks are in `ai-agent-live-check` (116), `queue-live-check` (84), `timeline-live-check` (36), `admin-leads-live-check` (55).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
