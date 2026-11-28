# T20 · The robot places the calls by itself

**Goal:** the right leads are called at the right time, at the pace the
people taking them can handle.

**Depends on:** T12-T19 · **Size:** - · **Status:** Done 2026-10-24 - a real look
found a due lead and called it, once · **Deploy note:** none until `AUTO_CALLS` is on.

## Build

- A new job in the worker loop, every 30 seconds, only with `AUTO_CALLS` on,
  calling set up, and inside the call hours and days.
- Who: arrived after `auto_calls_since` (saved the first time it runs
  switched on - as built, at every switch-on, after the review below), first
  text sent at least 1 hour ago, no reply, not blocked,
  not held, not Closed, never called by the robot. Oldest first.
- How many: people free, minus robot calls still going (no end, started
  within 10 minutes). None while anyone is on hold. None when nobody is free.
- Places each call as in T12, through `worker/place-auto-call.ts`, with
  `readAutoCallTestNumbers(env, NODE_ENV === 'production')`.
- Closes a row whose call never reached Twilio (T12: Twilio did not answer,
  and no webhook ever came) - for example as `failed` after 10 minutes, so it
  is not "under way" for ever.

**Files:** `backend/src/core/auto-dial.ts` (+ test), `backend/src/db/auto-dial.ts`,
`backend/src/db/call-script.ts` (+ `call-hours.test.ts`), `backend/src/worker/auto-calls.ts` (+ test),
`backend/src/worker/index.ts`, `backend/scripts/auto-dial-live-check.ts`; after
review also `backend/src/db/presence.ts`, `backend/src/db/hold-offers.ts`,
`backend/src/db/auto-calls.ts`, `backend/src/core/activity.ts`,
`backend/src/api/hold-watch.ts` (+ test), `backend/src/api/index.ts`,
`backend/src/api/twilio-webhooks.ts`, `backend/src/integrations/twilio-calls.ts` (+ test),
`backend/scripts/presence-live-check.ts`, `backend/scripts/hold-offers-live-check.ts`,
`backend/scripts/call-script-live-check.ts`.

## Done when

- [x] A live check of who is picked: the 1-hour wait, the hours, the days,
      held, Closed, blocked, already called, arrived before
      `auto_calls_since`. And: never texted, replied, rang us, a note, a
      lifted block picked, the conversation completed, expired or stopped,
      oldest first, the test numbers only, up to the room
      (`auto-dial-live-check`, 40 checks). The hours and the days in
      Arizona's own time, and malformed settings: unit tests.
- [x] A live check of timing: picked on the first check after its hour is
      up - not a second before; one whose hour ended overnight is picked
      first at 11am, before the morning's lead.
- [x] A live check of pace: never more calls than people free - a look with
      two free and one call going places one, the next none; none while
      someone is on hold; two workers never dial at once (the lock), and
      never call the same lead (T12's race). A call that never reached Twilio
      closed after 10 minutes, once.
- [x] A real run on the dev number, to test numbers only - 2026-10-24, a
      Saturday: one look, outside the days, wrote `auto_calls_since` and
      called nobody; with Saturday allowed in the local settings for the test
      and a lead whose first text went out 61 minutes before, one look found
      it and called it (call 65 - "No.", "No", not interested); the next look
      found nobody due. Run through the worker's own parts as one look
      (`dialDueLeads` with `autoDialler`'s pieces), not the whole worker: its
      poll would have texted every test contact added since the local
      checkpoint, 6 October.

## Docs to update in the same commit

`AUTO-CALLS.md`, "When a lead is called" and "Traffic"; `POLLER.md` (the
worker loop), `SCHEMA.md`, `AUDIT.md`, `LOGGING.md`, `README.md`, `CLAUDE.md`.

## As built

`AUTO-CALLS.md`, "When a lead is called" and "Traffic". Beyond the ticket:
**no reply means no call from them either**, and **nobody has worked the
lead** (`WORKED_SQL`), not only held or Closed - the same care as T0's
resend; **outside production only the test numbers are looked at**, so a
laptop's fake leads are not refused every half minute into the activity log;
and **an advisory lock** keeps a look to one worker. Settings read every look
(`readCallHours`), falling back to migration 015's values. 1,011 backend
tests (the hours, the room, a look's order).

**After an independent review** (2026-10-24, the same day), on its own branch:
a lead on hold whose call ended unreported stopped the robot for good,
silently - now an old hold does not count, and the watcher ends such a call
from Twilio's record; Twilio's reports not reaching us kept the robot calling
leads who heard only an error - now it stops, and says so once; a second
"yes" while a transfer rang heard the busy line - now that ring counts as
someone coming; a lead could reply or be picked up while the calls before it
went out - now each is asked again just before its call; switching off and on
again would have called the backlog - now each switch-on starts afresh, and
is recorded (reversed by T27, 2026-10-29: the leads already waiting are
called, after new leads); with no script active the same leads were refused every half
minute - now nothing is placed, said once; a late webhook could run the
script on a row already closed - now refused, and the close says only
`no_webhook`; a lock that could not be let go stayed in the pool - now thrown
away; a value in `settings.auto_calls_since` that is not a time is an error,
never a guess; and only the last 30 days of leads are looked at. 1,023 backend
tests (`readCallHours` on its own among them); `auto-dial-live-check` 58,
`presence-live-check` 57, `hold-offers-live-check` 34.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
