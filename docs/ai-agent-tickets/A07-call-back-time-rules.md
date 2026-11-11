# A07 · Call-back time rules

**Goal:** Pure rules for when Seri may book a call back, in the lead's own time zone.

**Why:** Times are easy to get wrong; they must be tested on their own.

**Depends on:** nothing  ·  **Size:** Small (a few hours)

## Build

- `backend/src/ai/callback-time.ts`.
- `leadTimeZone(phone)`: US area code to IANA zone (Arizona has no daylight saving: `America/Phoenix`). Unknown: `America/Phoenix`, and Seri asks. An area code that spans two zones takes the larger one; Seri's confirmation out loud catches the rest.
- `checkCallbackTime(when, leadZone, hours)`: inside agent hours (the `auto_call_*` hours and days, read by `readCallHours`), in the future, within 14 days. Returns ok, or the nearest allowed time to offer.
- `spokenTime(when, leadZone)`: "Thursday at 3 PM your time".

## Done when

- [ ] 8 PM is refused with the next morning offered; a weekend is refused with Monday offered.
- [ ] 3 PM in New York is 1 PM in Arizona in winter and **12 PM in summer** (Arizona keeps no daylight saving); the same instant is stored either way.

## Tests

- Area codes in several zones, Arizona, unknown; daylight saving dates; weekends; past times.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 4.

## Not in this ticket

- Saving the callback (A15).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
