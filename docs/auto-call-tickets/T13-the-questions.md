# T13 · The questions

**Goal:** a call goes through the whole script: answers, asking again, no
response, not interested, and stop.

**Depends on:** T7, T8, T12 · **Size:** - · **Status:** Done 2026-10-19 - six real
calls, every path · **Deploy note:** none.

## Build

- `POST /api/webhooks/twilio/auto/gather` - reads what Twilio heard, the keys
  and how sure it was; asks T7 what it means and T8 what to do; says it.
- One `call_answers` row per answer. Twilio sending the same request twice
  saves one row.
- The result is saved once (`script_result`, only if still empty); and when
  the call ends without one (`/auto/status`, T12): `unanswered` if it was
  never answered, `hung_up` if the script never finished.
- Replaces T12's stand-in on `/auto/gather`, which thanks the lead and ends
  the call whatever was said.
- A request with `CallStatus=completed` is a lead who hung up - found on the
  first real call: Twilio still asks `/auto/gather` after the hang-up, with
  nothing heard. Saved as `hung_up`, never taken as silence to ask again.
- Testing needs several real calls to one phone, and locally that phone can
  have only one: one lead per number (`leads_phone_key`) and one automated
  call per lead. A dev-only way to call again is needed first - decided here,
  never touching the production path's rules. Noted 2026-10-18.
- Stop -> the number is blocked (`blockNumber`, new reason `call_opt_out`),
  recorded in the activity log.
- The first question cannot be interrupted, so "Hello?" is not an answer.
  (As built: the greeting cannot be; the question itself can - "When the
  call listens".)
- A "yes" ends the call politely until T15a builds the transfer. (As built:
  the busy line, `transfer_missed`.)

**Files:** `backend/src/core/call-script.ts` (+ test), `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`, `backend/src/db/auto-calls.ts`,
`backend/src/db/call-script.ts`, `backend/src/db/dnc.ts`, `backend/src/integrations/twilio.ts`
(+ test), `backend/src/core/call-script-fixtures.ts`,
`backend/src/db/migrations/018_call_opening_and_voice.sql`, `backend/scripts/dev-auto-call.ts`,
`backend/scripts/auto-calls-live-check.ts`, `backend/scripts/call-script-live-check.ts`,
`frontend/src/pages/admin/DncPage.tsx`.

## Done when

- [x] Route tests for each path, and for the same request twice - 27 webhook
      tests; every path and every hang-up case of `handleAnswer`; the
      listening split. A live check proves the SQL: one answer per asking, a
      result never overwritten, a stop blocking once, the end settling an
      unfinished script (`auto-calls-live-check`, 54 checks).
- [x] Real calls, 2026-10-19, to Jeel's phone: yes -> the busy line; no ->
      Q2 -> "no thanks" -> not interested; silence twice -> no response; keys
      2 -> 1 -> link sent; 9 -> blocked, and a call to the blocked number then
      refused; "stop calling me" -> blocked.
- [x] Each answer is in `call_answers` with what was heard, how sure, and the
      keys.

## Docs to update in the same commit

`AUTO-CALLS.md` ("Understanding an answer", "What the call does after each
answer", "How a call is placed"), `AUDIT.md`, `SCHEMA.md`, `LOGGING.md`,
`README.md`, `CLAUDE.md`.

## As built

The rules are pure - `handleAnswer` in `core/call-script.ts`, on
top of T7 and T8 - and `keepAnswer` keeps an answer, its result and any
block in one transaction, each part safe to repeat. The real calls changed
three things. **Answers said over the end of a question were lost** - T12's
`<Gather>` did not listen while it spoke - so the greeting is now said with
nothing listening and the question itself with listening on
(`splitForListening`). **Kore's "won't" sounded like "will"** in "we won't
call you again", the line after a stop: "won't" and "didn't" are written out
in migration 018. And **a spoken answer takes about 4-5 seconds** to come
back against a key's instant one; Twilio's short-answer model, tried, was no
faster and far less sure, so it was dropped - T13b then halved Twilio's part
with Deepgram. A "yes" hears the busy
line until T15a. The link is saved as asked for, and texted since T14. `dev:auto-call`
gained `--again` and `--unblock` for testing with one phone. The DNC page
names the new reason, "Said stop on automated call". Found in the doc check
the same day: a stop on the call blocked the number but left the text
conversation open, unlike a STOP text or an agent's DNC - it now ends it too
(`keepAnswer`; `auto-calls-live-check`, 56 checks).

**The first real calls' confidence** (moved here from `AUTO-CALLS.md` on 2026-11-27, "Understanding an
answer"): clear answers came back 0.52 to 0.95 - "No." 0.52-0.70, "Yes." 0.61,
"No, thanks." 0.81, "Stop calling me." 0.95 - so 0.4 holds.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
