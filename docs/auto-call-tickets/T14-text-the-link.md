# T14 · Text the link

**Goal:** "yes" to question 2 texts the link, exactly once.

**Depends on:** T13 · **Size:** - · **Status:** Done 2026-10-19 - the link reached
Jeel's phone · **Deploy note:** none.

## Build

- The missed-call text sender becomes a general "send this text to this
  lead", given the text - the link text from the script's row
  (`call_scripts.link_text`, T6), the missed-call text from `settings` as
  today; the missed-call text works unchanged.
- On "yes": save `link_sent` first (only if the result is still empty); only
  then send the text, after Twilio has its answer.
- The text is saved in `messages` like every text; a blocked number gets
  none.

**Files:** `backend/src/db/lead-texts.ts` (was `missed-call-text.ts`),
`backend/src/db/auto-calls.ts`, `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`,
`backend/src/api/__tests__/calls.test.ts`, `backend/scripts/lead-texts-live-check.ts`,
`backend/scripts/auto-calls-live-check.ts`.

## Done when

- [x] Tests: the same request twice -> one text; a yes said as the lead hung
      up -> texted; Twilio answered without waiting on the text; no to the
      link -> none.
- [x] Tests: a blocked number -> no text, nothing on the thread
      (`lead-texts-live-check`, 15 checks, EZ Texting stubbed below its
      do-not-call check).
- [x] The missed-call text tests still pass - and it now has its own live
      checks, which it never had.
- [x] A real call: the link arrives on Jeel's phone - 2026-10-19, call 19:
      "No." 0.76, "Yes." 0.93, sent once, on the lead's thread.

## Docs to update in the same commit

`AUTO-CALLS.md`, "On a live call"; `TWILIO.md`, `POLLER.md`,
`STATE-MACHINE.md`, `LOGGING.md`, `AUDIT.md`, `README.md`, `CLAUDE.md`.

## As built

`db/missed-call-text.ts` became `db/lead-texts.ts` - one sender
for both texts, each reading its words (the settings row, the active script's
`link_text`); a missing one is `sms.no_template`. The link goes out only for
the request that kept the answer (`keepAnswer`'s `kept`, which now also names
the call's lead), after the response to Twilio; `link_sent` is saved in the
same transaction as the answer, before the text.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
