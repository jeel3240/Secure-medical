# T7 · Understanding a spoken answer

**Goal:** a spoken or keyed answer becomes yes, no, stop, or "not
understood" - never a guess.

**Depends on:** T6 · **Size:** - · **Status:** Done 2026-10-18 · **Deploy note:**
none.

## Build

- `matchSpokenChoice` - pure, no database. Takes what Twilio heard, the keys
  pressed, how sure Twilio was, and the question's choices.
- A key wins: 1, 2, or 9 for stop.
- Stop words win over every other answer.
- Otherwise each choice's words are looked for as whole words inside the
  sentence, longest first ("not interested" before "interested"). Exactly one
  choice found -> that choice. None or two -> not understood.
- Twilio less sure than the threshold -> not understood. No figure at all, or
  0 -> not counted against it.
- SMS matching (`matchChoice`) is not changed.

**Files:** `backend/src/core/answers.ts`, `backend/src/core/answers.spoken.test.ts`,
`backend/src/core/call-script-fixtures.ts`, `backend/scripts/call-script-live-check.ts`.

## Done when

- [x] Tests: "Yes, I am", "Yeah sure", "yes please" -> Yes; and on the link
      step "Sure, send it", "text me" -> Yes, "Don't text me" -> No.
- [x] Tests: "No", "No, I'm not interested", "not interested" -> No - never
      Yes for the "interested" inside it.
- [x] Tests: "Stop calling me", "remove me", "do not call", key 9, "nine" ->
      stop; it wins over anything else said, and when Twilio is unsure.
- [x] Tests: "yes no", "maybe", "what is this", "not really interested" ->
      not understood; nothing said or pressed -> silence.
- [x] Tests: keys 1 and 2 win over anything heard; another key is not
      understood; "one", "to", "won" said alone count as keys; "yes" heard
      with 0.21 -> not understood, at 0.4 -> Yes, with no figure or 0 -> Yes.
- [x] Every SMS matching test still passes - 65 answer tests in all.

## Docs to update in the same commit

`AUTO-CALLS.md`, "Understanding an answer"; `CLAUDE.md` §4.

## As built

The tests use `core/call-script-fixtures.ts`, the script as
migration 015 seeds it (and, since, 018 changes it), and `call-script-live-check.ts` compares that copy with
the database word for word, so the tests always use the real words. Sound-alike
number words ("to", "won") were added while building - the repeat line asks for
keys, and some people say the number instead.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
