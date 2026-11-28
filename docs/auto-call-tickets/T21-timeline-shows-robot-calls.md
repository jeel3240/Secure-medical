# T21 · The timeline shows the robot calls

**Goal:** an agent opening a lead sees what the robot did and what the lead
said.

**Depends on:** T13 · **Size:** - · **Status:** Done 2026-10-24 - seen on real calls:
taken, not interested with its answers, nobody took it · **Deploy note:** none until
robot calls exist.

## Build

- One line per robot call, in the timeline and the workspace conversation:
  "Automated call · voicemail left", "· link sent", "· not interested", "·
  opted out", "· no response", "· no answer", "· said yes · Maya Chen took
  it · 2:14", "· said yes · nobody free".
- Underneath, closed until opened like a transcript: each question and what
  the lead said ("Q1 · 'yeah sure' -> Yes").

**Files:** `backend/src/db/timeline.ts`, `backend/scripts/timeline-live-check.ts`,
`frontend/src/components/Timeline.tsx` (+ test), `frontend/src/components/CallAnswers.tsx`
(+ test), `frontend/src/pages/workspace/Conversation.tsx` (+ render test).

## Done when

- [x] Tests for every line - every result, who took it named once, the
      reasons a call was never picked up, no result yet; each answer in words
      (said, pressed, asked again, not understood, stop, nothing said), the
      fold closed until opened, nothing for any other call; the same in the
      conversation (374 frontend tests). A live check proves the query: a
      call going has no result and nothing said; taken, with who and how
      long; each answer in order, its question named "Q1"; an agent's call
      carries neither (`timeline-live-check`, 30).
- [x] Seen in the browser on a lead after a real call - 2026-10-24, Jeel:
      lead 50, "said yes · nora took it"; lead 59, "not interested", its
      Answers opened; lead 51, "said yes · nobody took it".

## Docs to update in the same commit

`AGENT-WORKSPACE.md`; `AUTO-CALLS.md`; `FRONTEND.md`, `README.md`, `CLAUDE.md`.

## As built

`TIMELINE.md` (then `AGENT-WORKSPACE.md`, "The timeline"). Two wording choices beyond
the ticket: **"said yes · nobody took it"**, not "nobody free" - the same
result covers people who let it ring and a lead who hung up waiting; and
**who took it is named in the line**, so not again beside it. Also "· hung
up" for a lead who left before the script finished, and Twilio's own word
for a call never picked up - no answer, busy, failed.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
