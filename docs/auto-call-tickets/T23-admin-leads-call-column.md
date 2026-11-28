# T23 · Admin > Leads: the Call column

**Goal:** a superadmin sees every lead's robot-call result and can filter on
it.

**Depends on:** T4 · **Size:** - · **Status:** Done 2026-10-25 - seen in the browser
on real calls' leads: voicemail left, not interested, no answer, said yes taken and
not · **Deploy note:** an empty column until robot calls exist.

## Build

- A **Call** column: the last robot call's result, in short words, or blank.
- A filter on it, kept in the address like the other filters.
- No new status or tab.

**Files:** `backend/src/db/leads.ts`, `backend/src/api/admin/leads.ts`,
`backend/src/api/__tests__/admin-leads.test.ts`,
`backend/scripts/admin-leads-live-check.ts`, `backend/scripts/speed-check.ts`,
`frontend/src/lib/call-results.ts` (+ test), `frontend/src/components/Timeline.tsx`,
`frontend/src/api/leads.ts`, `frontend/src/pages/admin/LeadsPage.tsx`,
`frontend/src/lib/leads-view.ts` (+ test).

## Done when

- [x] Tests: the column and the filter. A live check through the robot's own
      write (`startAutomatedCall`): each result; two tracks at once, Awaiting
      reply and Voicemail left; a "yes" taken reading Working; Calling now and
      No result by the call's age; a lead never called, and an agent's own
      call, reading nothing; the filter alone, with a tab, and narrowing the
      tab counts; Not called (`admin-leads-live-check`, 51). Route tests: every
      value passed through, anything else 400 `invalid_call` (1,042 backend
      tests). The words, the filter's choices, and the address keeping the
      filter (390 frontend tests).
- [x] Seen in the browser, 2026-10-25, Jeel: the Call column on the leads
      of the real test calls - Voicemail left, Not interested, No answer,
      Said yes · nobody took it, Said yes · taken (those two Working) - each
      beside its own status, Awaiting reply or Working. The filter on the
      same local data: Voicemail left, 5 leads, the tabs 4 Awaiting reply and
      1 Working.
- [x] `npm run speed`: Admin > Leads still loads quickly - unchanged within
      a few milliseconds; filtering on one call result 39 ms at 50,000 leads
      (`ADMIN-LEADS.md`, "How fast it is").

## Docs to update in the same commit

`ADMIN-LEADS.md`; `AUTO-CALLS.md`; `FRONTEND.md`, `LEAD-FLOW.md`,
`DESIGN-PROMPT.md`, `README.md`, `CLAUDE.md`.

## As built

`ADMIN-LEADS.md`, "Call". Beyond the ticket: **two values the
script never writes** - "Calling now" while a call has no result yet, and "No
result" when it still has none an hour on, so a call whose end never reached
us does not read "Calling now" for ever; **"Not called" as a filter**; and
**one wording for the timeline and this page**, `lib/call-results.ts`, which
took over the timeline's own list. The filter narrows the tab counts, as
Source and Received do.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
