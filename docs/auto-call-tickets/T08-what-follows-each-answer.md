# T8 · What the robot does after each answer

**Goal:** the whole script's logic is one pure function, tested on its own.

**Depends on:** T6, T7 · **Size:** - · **Status:** Done 2026-10-18 · **Deploy note:**
none.

## Build

- `core/call-script.ts`: given the script, the question, whether it is the
  first or second try, and the answer, it returns what to say and what comes
  next - ask the next question, ask again, transfer, send the link, or end
  with a result.
- Not understood, first time -> the repeat line ("Press 1 for yes, 2 for no,
  or 9 to stop these calls."); second time -> "Thank you for your time. Have a
  great day." and `no_response`. Silence counts as not understood.
- Stop -> "Okay, we will not call you again. Goodbye.", `opted_out`, and the
  number to be blocked.
- A choice -> its reply line, then its next question or its ending.
- A script that points at a question that does not exist ends the call
  politely, never loops.

**Files:** `backend/src/core/call-script.ts`, `backend/src/core/call-script.test.ts`.

## Done when

- [x] A test for each path: Q1 yes -> transfer; Q1 no -> Q2, said with the
      reply; Q2 yes -> link; Q2 no -> not interested; not understood once and
      twice; silence once and twice; stop on Q1 and Q2, on either asking; an
      answer on the second asking; a broken script four ways (an unknown step,
      a missing next step, a step leading back, no steps) - 22 tests.

## Docs to update in the same commit

`AUTO-CALLS.md`, "What the call does after each answer"; `CLAUDE.md` §4.

## As built

`CallAction` is what the webhooks carry out - ask a step (with the
lines to say and which asking it is), transfer, or end with a `CallResult`
(the `script_result` values) and flags: send the link, block the number, or a
broken script to log. `answerRecord` gives the `call_answers` row for an
answer. 757 backend tests pass.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
