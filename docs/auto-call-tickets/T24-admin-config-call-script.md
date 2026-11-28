# T24 · Admin > Configuration shows the call script

**Goal:** a superadmin can read the call script and its settings, as the
robot will use them.

**Depends on:** T6 · **Size:** - · **Status:** Done 2026-10-25 - seen in the browser:
every line in order with its keys and words, and the settings, matching the database ·
**Deploy note:** visible, read-only.

## Build

- A "Call script" section: each question, its answers and replies, the
  repeat line, the voicemail, the busy and hold lines, the link text.
- The call settings: hours, time zone, days, wait, ring time, hold safety
  stop.
- Read-only, like the rest of the page.

**Files:** `backend/src/db/admin-config.ts`, `backend/src/api/admin/config.ts`,
`backend/src/api/__tests__/admin-screens.test.ts`, `backend/scripts/admin-live-check.ts`,
`frontend/src/api/admin.ts`, `frontend/src/pages/admin/ConfigPage.tsx` (+ test),
`frontend/src/lib/call-settings.ts` (+ test).

## Done when

- [x] Seen in the browser, matching the database - 2026-10-25, Jeel, on the
      local app: the Call script card, all fifteen lines in order, each
      answer with its key and words, `{place}` as "2, 3…" and the voicemail's
      number as "our number" (calling not set up locally); the Calls card -
      Off, 11:00 AM - 5:00 PM, America/Phoenix, Monday to Friday, 1 hour, 25
      and 20 seconds, 10 minutes, 0.4; Call · link last under Messages.
- [x] A live check: every line in order and word for word against the
      script the robot uses; names, when, keys and words; the link text
      under Messages; the settings off and on; the recording notice only on
      recorded calls; a setting changed by migration; one the robot cannot
      read showing what it uses; no script active (`admin-live-check`, 77).
      Route tests: the api passes whether automated calls are on, the
      calling number and whether calls are recorded (1,045 backend tests).
      The settings and placeholders in words (397 frontend tests).

## Docs to update in the same commit

`ADMIN.md`; `AUTO-CALLS.md`; `FRONTEND.md`, `DESIGN-PROMPT.md`, `README.md`,
`CLAUDE.md`.

## As built

`ADMIN.md`, "The automated call". Beyond the ticket: **the values
are the robot's own readers'**, so a setting it cannot read shows what it
uses instead; **whether automated calls are on**, and the call-back number
the voicemail gives; **the confidence a spoken answer needs** and **a ring
from hold's time** beside the ticket's settings; **what picks each answer** -
its key and the words heard for it; **the recording notice**, listed when
calls are recorded; and **the link text under Messages**, counted for
segments like every other text, rather than in the call card. Split into
tabs after it was merged, at Jeel's request the same day - Texts, Scoring,
Calls - since the one page had grown too long (`ADMIN.md`, "Three tabs").

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
