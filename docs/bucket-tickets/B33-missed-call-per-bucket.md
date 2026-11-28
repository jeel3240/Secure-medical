# B33 · Missed-call text and line per bucket

**Goal:** when a lead's call to us goes unanswered, the line they hear and the text
they get are their own bucket's.

**Why:** the text is one `settings` row, `message_missed_call`, and the spoken line is
a constant, `MISSED_CALL_SPEECH` (`backend/src/core/calls.ts`), that names eDrugstore
(review, 2026-11-27). A weight-loss lead would hear and read antibiotics' brand.

**Depends on:** B07 · **Size:** S · **Status:** To do · **Deploy note:** the code reads
columns its migration adds - outside the robot's hours until B02 is in.

## Build

- **Migration:**
  - `buckets.missed_call_text TEXT NOT NULL` - antibiotics' copied from
    `settings.message_missed_call`;
  - `buckets.missed_call_speech TEXT NOT NULL` - antibiotics' with
    `MISSED_CALL_SPEECH`'s words exactly;
  - the `message_missed_call` settings row deleted - a guard first: it stops unless
    the copy equals it (each fact in one place).
- `backend/src/db/lead-texts.ts`: `sendMissedCallText(leadId)` - the lead's current
  bucket's text (its newest conversation's flow's bucket).
- `backend/src/api/twilio-webhooks.ts` (an agent's call that went missed, and an
  incoming call nobody took) and `backend/src/integrations/twilio.ts`
  (`missedCallTwiml(speech)`): the caller's lead's bucket's line. An unknown caller -
  no lead - hears a neutral line with no brand, the words approved by Jeel in this
  ticket's PR, and gets no text, as today.
- `MISSED_CALL_SPEECH` removed from `core/calls.ts`.
- `backend/src/db/admin-config.ts`: the bucket's missed-call text.
- With one calling number per bucket (an open question to the client), the bucket
  would come from Twilio's `To` instead - not built here.

## Done when

- [ ] `scripts/lead-texts-live-check.ts`: a lead in bucket B gets B's text; a lead with
      no conversation gets none; a blocked number gets none.
- [ ] `scripts/missed-call-upgrade-check.ts` (B03): the copy equals the settings row;
      the row gone; the migration stops when they differ.
- [ ] `src/api/__tests__/calls.test.ts`, `auto-call-webhooks.test.ts`: the bucket's
      line spoken; the neutral line for an unknown caller.

## Tests

As above.

## Docs to update in the same commit

`docs/TWILIO.md` ("A missed call"), `docs/SCHEMA.md`, `CLAUDE.md` §5 and §6 (where the
missed-call text lives), `docs/WORKFLOW.md`, `docs/ADMIN.md`, `docs/BUCKETS.md`.

## Not in this ticket

A calling number per bucket.

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
