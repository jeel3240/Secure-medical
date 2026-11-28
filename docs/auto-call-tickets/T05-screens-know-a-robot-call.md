# T5 · The screens know a robot call from an agent's call

**Goal:** nothing on screen counts a robot call as an agent's.

**Depends on:** T4 · **Size:** - · **Status:** Done 2026-10-18 · **Deploy note:**
none.

## Build

- The call direction type includes `automated`.
- "Calling back · you tried 2× today" counts only agents' calls.
- The timeline and the workspace conversation show a robot call as
  "Automated call", until T21 gives it its full wording (built - "Where it shows").

**Files:** `frontend/src/api/workspace.ts`, `frontend/src/lib/caller-context.ts`
(+ test), `frontend/src/components/Timeline.tsx` (+ test),
`frontend/src/pages/LeadTimelinePage.tsx` (+ test).

## Done when

- [x] Tests: a robot call is not counted in "you tried" - alone it gives no
      "Calling back" line (changed in T19: "· automated call, 28m ago");
      beside an agent's call, only the agent's counts.
- [x] Tests: a robot call shows on the timeline and in the conversation as
      "Automated call · answered · 40s", "· no answer", "· voicemail", "· in
      progress" - never as "Outbound call".
- [x] Tests: the Lead Timeline's "Attempts" counts it as one of ours, and it
      is not contact from the lead.

## Docs to update in the same commit

`FRONTEND.md`, `AGENT-WORKSPACE.md`, `TWILIO.md`.

## As built

`CallDirection` in `api/workspace.ts` mirrors the backend's.
"Attempts" keeps its rule - every call that is not the lead's - because a robot
call is our attempt to reach them. 299 frontend tests pass.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
