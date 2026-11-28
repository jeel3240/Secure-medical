# T17 · The next free person gets the waiting lead

**Goal:** someone finishing a call is offered the lead on hold before
anything else.

**Depends on:** T16 · **Size:** - · **Status:** Done 2026-10-22 - real calls: rung
when the call ended, when the note was saved, when skipped; declined and rang out back
on hold · **Deploy note:** none.

## Build

- When someone becomes free - their call has ended and their note is saved or
  skipped - and a lead is on hold, the oldest waiting lead rings them alone
  for 20 seconds.
- They accept -> as in T15a. They do not -> the lead goes back on hold, and
  their switch turns off as in T15c.

**Files:** `backend/src/db/migrations/020_hold_offers.sql`,
`backend/src/db/hold-offers.ts`, `backend/src/core/call-script.ts` (+ test),
`backend/src/api/hold-watch.ts` (+ test), `backend/src/api/calls.ts`,
`backend/src/api/index.ts`, `backend/src/api/twilio-webhooks.ts`,
`backend/src/db/auto-calls.ts`, `backend/src/db/presence.ts`,
`backend/src/db/call-script.ts`, `backend/src/integrations/twilio.ts`,
`backend/src/integrations/twilio-calls.ts` (+ test),
`backend/src/api/__tests__/auto-call-webhooks.test.ts`,
`backend/src/api/__tests__/calls.test.ts`,
`backend/scripts/hold-offers-live-check.ts`,
`backend/scripts/presence-live-check.ts`,
`backend/scripts/auto-calls-live-check.ts`,
`backend/scripts/call-script-live-check.ts`.

## Done when

- [x] Two browsers: A on a call, the lead on hold, A ends and saves the note
      -> A's browser rings with the lead -> A accepts and holds it -
      2026-10-22, calls 50 and 53: rung 16 ms after the note was saved.
- [x] A skips the note instead -> the same - call 55, rung at once.
- [x] A does not accept -> the lead is back on hold - calls 48 (rang out:
      the switch off) and 55 (declined: the switch on); nobody else coming,
      so the busy line straight after.
- [x] Tests: `pickOffer` - longest waiting first, never the same person
      twice, a lead already ringing passed over, only the person who came
      free; `holdGoesOn` with who is coming; the watcher - offers before
      sending anyone to the busy line, one offer for the person who came
      free, a ring Twilio would not take ended `unsent`, a lead ringing left
      alone; the webhooks - the ring from hold, gone, hung up, not ours, 404
      off and 403 unsigned, the music page's own request changing nothing,
      rang out, declined, a ring that never completed, hung up while ringing,
      taken, the notice on a yes put on hold; the browser's word and the
      switch offering a lead (965 backend tests). A live check proves migration 020 and the SQL:
      longest waiting first, one live offer per lead and per person, never
      offered twice, ended once and never removed, the switch off and a busy
      browser never offered, taken ends the offer, an offer never heard back
      expired, a lead no longer on hold never offered, and who is still coming
      (`hold-offers-live-check`, 31 checks); the two minutes after a call
      (`presence-live-check`, 52).

## Docs to update in the same commit

`AUTO-CALLS.md`, "The hold line"; `SCHEMA.md`, `AUDIT.md`, `LOGGING.md`,
`TWILIO.md`, `WORKFLOW.md`, `README.md`, `CLAUDE.md`.

## As built

`AUTO-CALL-TRANSFER.md`, "The hold line", "The next person who comes free
gets the waiting lead". Four things beyond the ticket. **A ring from hold is a `call_offers`
row** (migration 020), so the same lead is never offered twice to one person
and two triggers can never ring at once - and the offer is written before
Twilio is asked, because Twilio follows the redirect while still sending the
music page's own request (call 46). **Someone writing the note of a call that
just ended keeps a lead waiting**, for two minutes - found on the first note
test: such a person counted as nobody, so the lead would have heard the busy
line before the note was saved. **A lead waits while anyone is coming for
it** - on a call, writing a note, free, or ringing with another lead - not only
while someone is on a call. And **a yes put on hold before any ring hears the
recording notice** then: T16 never said it, and the ring from hold says
nothing. The ring time is a setting, `auto_call_offer_ring_seconds`.

**Twilio's two requests as the music is cut** - proved on a real call before
building (2026-10-22, call 46, the watcher redirecting to a page that said
"Two." - moved here from `AUTO-CALLS.md` on 2026-11-27, "The hold line"): Twilio sends the music page's own
`<Redirect>` to `/auto/hold`, and the API redirect's address too, and
**follows the API redirect** - "Two." was heard and the call ended 2 seconds
after. The music page's request comes first.

**What the real calls showed** (2026-10-22, Jeel's phone on hold, nora on a call
added by hand, then nora's real browser):

- **nora's call ends, nora's window rings, nora takes it** (call 50): rung 17
  seconds after the call row ended - the browser saw no call end, so it was
  its next 30-second word - accepted 7 seconds later; nora holds the lead,
  `transferred`.
- **The note saved** (call 53): nora's note box open from a real call, the
  lead on hold; the call row ended and nothing rang for 35 seconds, the lead
  still on hold; the note saved at 06:01:13.904 and nora's window rang 16 ms
  later; taken.
- **The note skipped, then declined** (call 55): rang at once on Skip;
  declined - the offer `declined`, nora's switch left on, and with nobody else
  coming, the busy line 6 seconds later, `transfer_missed`.
- **Rang out** (call 48): the offer `missed`, nora's switch turned off, and
  the busy line straight after - nobody else was coming.
- **Found on the note test, and fixed before it:** someone writing the note of
  a call that just ended counted as nobody - not on a call, not free - so a
  lead on hold would have heard the busy line within 30 seconds of the call
  ending, before the note could be saved. Hence the two minutes, both for
  going on hold and for waiting on it.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
