# T6 · The call script saved as rows

**Goal:** the script - every line and every accepted word - is in the
database, and there is a place to keep what each lead says.

**Depends on:** T4 · **Size:** - · **Status:** Done 2026-10-18 · **Deploy note:**
none.

## Build

- Migration 015:
  - `call_scripts` - one per script, only one active.
  - `call_steps` - the script's questions: key, position, the line, the
    repeat line.
  - `call_choices` - each answer: key (`1`, `2`), label, accepted words,
    the reply line, and either the next step or an ending (`transfer`,
    `send_link`, `declined`) - never both.
  - Stopping is the same on every question: "stop calling", "remove me",
    "do not call", or 9.
  - `call_answers` - one row per answer, never changed or deleted: the call,
    the lead, the step, what Twilio heard, how sure, the keys pressed, the
    choice matched (empty = not understood).
  - Seeded with the script in "The script" (`AUTO-CALL-SCRIPT.md`).
  - Settings rows: call hours (11:00-17:00), time zone (America/Phoenix),
    days (Monday-Friday), wait after the first text (60 minutes), ring time
    (25 s), hold safety stop (10 minutes), confidence threshold (0.4). The
    texts - link text, voicemail, busy line, hold line - went on the script's
    row instead (see "As built" below).
- `db/call-script.ts` loads the active script.
- The link texted on "yes" is the one the SMS script already sends,
  https://www.edrugstore.com/anti-ez (Jeel, 2026-10-17).

**Files:** `backend/src/db/migrations/015_call_script.sql`,
`backend/src/core/call-script.ts`, `backend/src/db/call-script.ts`,
`backend/scripts/call-script-live-check.ts`.

## Done when

- [x] The migration runs on the local database, and a second run applies
      nothing.
- [x] A live check: editing or deleting a `call_answers` row is refused; the
      same asking cannot be saved twice; a choice row must name its choice and
      nothing else may.
- [x] A live check: a choice with both a next step and an ending is refused,
      and one with neither; 9 as a choice; an unknown ending; a choice into
      another script; a second active script.
- [x] The loader returns the script exactly as written in "The script" - the opening
      line, the repeat line, both steps' choices, the stop words, the
      voicemail without email, the anti-ez link - and the eight settings.

## Docs to update in the same commit

`AUTO-CALLS.md`, `SCHEMA.md`, `AUDIT.md`, `README.md`, `WORKFLOW.md`,
`CLAUDE.md`.

## As built

One change from the plan: **the script's own words are on its
`call_scripts` row, not in `settings`** - stop, no response, voicemail, busy,
hold, the link text and the voice. They are the script's words, in
eDrugstore's voice, and a script for another group brings its own. `settings`
keeps only the call center's numbers: hours, time zone, days, wait, ring
time, hold stop, confidence. The types are in `core/call-script.ts`, so the
pure rules of T7 and T8 need no database. `scripts/call-script-live-check.ts`,
29 checks; 17 live checks in all.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
