# A19 · Seri's conversation on the timeline

**Goal:** The agent who takes the transfer or call back sees what the lead already said to Seri.

**Why:** So the lead does not have to repeat themselves.

**Depends on:** A10  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-12

## Build

- `backend/src/db/timeline.ts`: the robot call carries its `call_ai_turns` and `ai_ended_with`.
- `frontend/src/components/CallAnswers.tsx` (or a sibling): under the robot call, a short chat: Lead / Seri, and how it ended ("Booked a call back: Thu 3:00 PM"; "Seri stopped - the call went on with the script" for a fallback).
- Uses the existing timeline styles.

## Done when

- [x] Timeline live check returns the turns in order, and how Seri's part ended - a call back, a fallback of hers and of Twilio's, a choice the voicemail overtook, a call she never took (`timeline-live-check`, 36).
- [x] Frontend test renders a chat and an action line - and every ending in words (15).

## Tests

- Live check; component test.

## Docs to update in the same commit

- `docs/AGENT-WORKSPACE.md` timeline.

## Not in this ticket

- Admin screens (not wanted).

## As built

- **`seriPart`** (`db/timeline.ts`): on a call she took (`ai_started_at`), `detail.seri = { turns, ended }` - the `lead` and `seri` turns in order, her `system` notes left out; `ended` her last `action` turn when it is what `ai_ended_with` records, a bare fallback for one Twilio's side caused, and null when nothing was recorded - the lead hung up first, or the voicemail took the call (A18 keeps her choice at once, so a choice alone is not how it ended).
- **`SeriConversation`** (`frontend/src/components/`), beside `CallAnswers` in the workspace conversation and on the Lead Timeline: a closed "Seri" fold in the transcript's own classes - no new styles - and `seriEndedText`, every ending in words. A call back's time in the viewer's own time.
- **Tests:** 5 live checks, 15 component tests.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
