# A19 · Seri's conversation on the timeline

**Goal:** The agent who takes the transfer or call back sees what the lead already said to Seri.

**Why:** So the lead does not have to repeat themselves.

**Depends on:** A10  ·  **Size:** Small (a few hours)

## Build

- `backend/src/db/timeline.ts`: the robot call carries its `call_ai_turns` and `ai_ended_with`.
- `frontend/src/components/CallAnswers.tsx` (or a sibling): under the robot call, a short chat: Lead / Seri, and how it ended ("Booked a call back: Thu 3:00 PM"; "Seri stopped - the call went on with the script" for a fallback).
- Uses the existing timeline styles.

## Done when

- [ ] Timeline live check returns the turns in order, and how Seri's part ended.
- [ ] Frontend test renders a chat and an action line.

## Tests

- Live check; component test.

## Docs to update in the same commit

- `docs/AGENT-WORKSPACE.md` timeline.

## Not in this ticket

- Admin screens (not wanted).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
