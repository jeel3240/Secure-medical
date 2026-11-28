# T11 · Several browsers ringing at once

**Goal:** when a call rings several people, the ones who did not take it see
nothing odd, and nobody loses an unsaved note.

**Depends on:** - · **Size:** - · **Status:** Done 2026-10-18 · **Deploy note:** none
- nothing rings several people yet.

## Build

- A call that rings several people carries `ring=group`; a transfer also
  carries `reason=transfer`.
- Someone else accepted it -> the card clears quietly, with no "Missed call"
  notice.
- A ring that arrives while an after-call note is open is not shown; the note
  stays.
- A transfer's card reads "Transfer · said yes to the offer", without the
  "Calling back" line.
- A call that rings one person behaves exactly as today.

**Files:** `frontend/src/lib/incoming-state.ts` (+ test), `frontend/src/lib/incoming-call.ts`,
`frontend/src/lib/calling.ts` (+ tests), `frontend/src/lib/caller-context.ts` (+ test),
`frontend/src/layout/IncomingCall.tsx` (+ test).

## Done when

- [x] Tests: a group ring taken by someone else -> nothing shown, no "Missed
      call", the ring stops.
- [x] Tests: a one-person ring not answered -> "Missed call", as today.
- [x] Tests: a group ring while the note is open -> declined, and the note
      kept as typed; the same while a call or note from a lead's page is open.
      A one-person ring still takes the note box's place, as today.
- [x] Tests: the transfer card's wording, with no "Calling back" line; the
      ring's kind read from the call - 339 frontend tests.
- [x] Seen in the local app, the card's state set in the page (nothing rang):
      a transfer reads "Transfer · said yes to the offer"; an ordinary call
      back keeps its "Calling back" line; no console errors.

## Docs to update in the same commit

`FRONTEND.md`, `TWILIO.md` ("A ring that goes to several people"), `CLAUDE.md`.

## As built

A ring is marked with `<Parameter>`s - `ring=group`,
`reason=transfer`, and `step`, the heading of the question the lead said yes
to - which the server sends for a transfer since T15a, and `ring=group`
alone for a call back ringing everyone free since T19; the card's words come from the script's rows: "said yes to the offer"
from the step "Offer" (`transferContext`). `ringKind` in `lib/calling.ts`
reads them; each ring carries its `RingKind` through `lib/incoming-state.ts`.
A group ring arriving while anything keeps the browser busy - including a
call or note on a lead's page, which the incoming store cannot see - is
**declined** rather than ignored (`lib/presence.ts`, from T9): Twilio keeps
ringing the others, and the whole ring is busy only when every browser was
("Busy Everywhere", error 31600) - one browser declining was confirmed to
leave the other ringing on the first real group ring (T15a, 2026-10-20). A one-person ring is unchanged, including taking an open note
box's place: it is that agent's own lead calling.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
