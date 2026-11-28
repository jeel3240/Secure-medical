# T0 · Resend the first texts the EZ Texting block stopped

**Goal:** leads saved while EZ Texting was blocked (from 2026-10-14) get
question 1.

**Depends on:** - · **Size:** - · **Status:** Done 2026-10-16 - run on the server for
the 174 leads of the block · **Deploy note:** nothing until Jeel runs the command,
once EZ Texting has unblocked the account.

## Build

(as built - `POLLER.md`, "Resending after an outage")

- A command, `npm run openers:send-waiting`, compiled into the image (not in
  `scripts/`, which production does not have).
- Arguments: `--from` and `--to` (when the leads arrived; a date without an
  offset is Arizona time), `--every` (default 30 seconds, never under 10),
  `--limit` (stop after this many texts), `--dry-run`.
- Which leads never got their first question is one definition,
  `db/openers-never-sent.ts`, moved out of the retry so the two share it.
  On top of it: **only leads the retry has given up on** (5 attempts used, or
  older than 24 hours), so the two never text the same lead; only leads in the
  window; and **only leads nobody has worked** - not picked up, no call,
  outcome, callback, note or agent text (added while building: days later, a
  lead a person dealt with must not get an automated first question).
- Each lead is checked again just before its text; sent with `sendOpener`,
  which also opens the reply window.
- **One text every 30 seconds**, never two at once; a skipped lead does not
  make the next one wait again.
- **Stops at the first refusal or unanswered request** from EZ Texting and
  prints which lead and how many were sent. Run again, it carries on: sent
  leads no longer match.
- One run at a time: an advisory lock held for the whole run.
- `--dry-run` sends nothing; it lists the leads, and separately any lead
  already expired without a first text (not sent - its conversation is over).
- Prints to the terminal only; each text is its `messages` row, as for every
  automated text.

**Files:** `backend/src/cli/send-waiting-openers.ts`,
`backend/src/worker/send-waiting-openers.ts`, `backend/src/core/resend-args.ts`
(+ test), `backend/src/db/openers-never-sent.ts`,
`backend/src/worker/retry-openers.ts`, `backend/package.json`,
`backend/scripts/send-waiting-openers-live-check.ts`.

## Done when

- [x] A live check: picks only the leads the retry gave up on; skips a lead
      that replied, one a person worked, one with a text still `sending`, a
      blocked number, and one from before the window.
- [x] Run twice, no lead is texted twice.
- [x] Keeps the pace: one pause of `--every` between texts, none before the
      first.
- [x] Stops at a refusal, and carries on from there when run again; stops at
      an unanswered request and never sends that one again.
- [x] A lead that replies or is blocked while it runs is skipped.
- [x] A second run is refused while one is going.
- [x] The retry's own live check passes unchanged; all 16 live checks pass.
- [x] Jeel runs `--dry-run` on the server and checks the list before the real
      run - 2026-10-16: 174 leads, every one with 5 failed attempts, arrived
      Oct 14 3:23-5:32 AM and Oct 15 3:00-5:51 AM (Arizona time); then the
      real run, one text every 30 seconds.

## Docs to update in the same commit

`POLLER.md`, "Resending after an outage" (and the exception noted
under the retry's "never days late" rule); `LOGGING.md`, `AUDIT.md`,
`README.md`, `CLAUDE.md`.

## As built

Built as *Build* says - its first line names where it is written down.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
