# T15a · The transfer: everyone free

**Goal:** a "yes" reaches a person: everyone free rings, and the first to
accept has the lead.

**Depends on:** T10, T11, T13 · **Size:** - · **Status:** Done 2026-10-20 - real
transfers: taken, taken after a decline, taken by nobody · **Deploy note:** none.

## Build

- On "yes" (never when the call is a machine): "Great, connecting you with a
  live agent now. Please hold.", then the recording notice.
- Ring everyone free (at most 10) together for 25 seconds, carrying the lead
  and `ring=group`, `reason=transfer` and `step` - the heading of the
  question the lead said yes to (T11, `TWILIO.md`). No per-person end
  reports - the end is taken from the call itself.
- The first to accept: `POST .../auto/claim` makes them the lead's holder
  (taking over from anyone else, recorded with who it was taken from), saves
  them on the call, and the result `transferred`.
- Nobody accepts -> the busy line, `transfer_missed` (T16 adds the hold line
  before it). Nobody free -> the busy line at once.
- Recording starts when the agent joins, as on every other call.
- Confirm on the first real group ring that one browser declining leaves the
  others ringing (T11 relies on it), and that the lead is on channel 1 of the
  recording (T4 assumed it).

**Files:** `backend/src/core/call-script.ts` (+ test),
`backend/src/integrations/twilio.ts` (+ test), `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`, `backend/src/db/auto-calls.ts`,
`backend/src/db/call-script.ts`, `backend/src/core/activity.ts`,
`backend/scripts/auto-calls-live-check.ts`.

## Done when

- [x] Tests: `planTransfer` - people free, more than 10, nobody, a machine;
      `transferTwiml` - the lines, the notice only on a recorded call, one ring
      per person with this server's names and the lead, the ring time; the
      webhooks - both new ones 404 while off and 403 unsigned; free people
      rung, nobody free, a machine, a yes as the lead hung up, a person
      accepting, refused, a leg of another call, another server's browser
      name, the database failing, the ringing over taken and not taken in four
      ways ("the transfer (T15a)", 46 webhook tests).
- [x] A live check of `takeTransfer`: taking over from the lead's holder; the
      same request again; a second person refused; a lead nobody held; the
      browser's own pick-up first - no second pick-up, the transfer still
      recorded; a deactivated account refused; no such call; and
      `missTransfer` never overwriting a result (`auto-calls-live-check`, 76
      checks).
- [x] Two browsers, a real call: A accepts -> A holds the lead, the call is A's
      and `transferred`, the recording saved - 2026-10-20, calls 20 and 22.
- [x] Nobody accepts -> both rang, the busy line, `transfer_missed`, nobody
      holds the lead - call 21.
- [x] B declines -> A keeps ringing, and takes it - call 22.
- [x] B on a call -> B is not rung: a transfer rings only `freePeople`, and
      `FREE_SQL` leaves out anyone on a call (T10, `presence-live-check`).
- [x] The lead on channel 1: different words said on each side, each under its
      speaker in the transcript - call 23.

## Docs to update in the same commit

`AUTO-CALLS.md`, "The transfer"; `TWILIO.md`, `AUDIT.md`, `LOGGING.md`,
`README.md`, `CLAUDE.md`.

## As built

`AUTO-CALL-TRANSFER.md`, "The transfer". One addition: **`call.transferred`**, a new action -
the first real transfer was taken in a browser whose own pick-up of the lead
reached the server first, so `lead.picked_up` was the browser's and nothing
recorded that a transfer had been taken. A yes from a machine, if Twilio's
verdict has come, rang nobody and ended as `no_response` - until T18, which
hands a machine to the voicemail message instead (`AUTO-CALL-SCRIPT.md`, "Voicemail"). The ring time is
the `auto_call_ring_seconds` row, read on every transfer (`readRingSeconds`).

**What the real transfers showed** (2026-10-20, Jeel's phone, two browsers on
the dev number - moved here from `AUTO-CALLS.md` on 2026-11-27, "The transfer"; the notes from T15b's and
T15c's calls are in those tickets):

- **The browser picks the lead up as it accepts** (`lib/incoming-call.ts`,
  `claimLead`), and that request can reach the server before Twilio's
  `/auto/claim`. The lead is then already theirs, so `lead.picked_up` is the
  browser's, without `via: transfer` - and nothing said a transfer was taken.
  `call.transferred` was added for that: it is written whichever arrives
  first.
- **One browser declining leaves the others ringing** - T11 relies on it. The
  Decline button and a busy browser's automatic decline are the same request
  to Twilio (`call.reject()`).
- **The channels are as above**, checked by saying different words on each
  side: the lead's on channel 1, the person's on channel 2 (T4 had assumed
  it).
- **About 44 seconds from the lead's "yes" to the busy line** when nobody takes
  it: about 19 for the reply and the recording notice, then the 25 of ringing.
- A finished transfer leaves its note box open, as every call does, and the
  browser counts as busy - not rung for the next transfer - until the note is
  saved or skipped (T9).
- **Safari started the ringtone again by itself** a few seconds after a ring
  ended - fixed on its own, `INCOMING-CALLS.md`, "Safari starts it again by itself".

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
