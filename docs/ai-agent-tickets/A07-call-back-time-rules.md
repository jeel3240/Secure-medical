# A07 · Call-back time rules

**Goal:** Pure rules for when Seri may book a call back, in the lead's own time zone.

**Why:** Times are easy to get wrong; they must be tested on their own.

**Depends on:** nothing  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-11

## Build

- `backend/src/ai/callback-time.ts`.
- `leadTimeZone(phone)`: US area code to IANA zone (Arizona has no daylight saving: `America/Phoenix`). Unknown: `America/Phoenix`, and Seri asks. An area code that spans two zones takes the larger one; Seri's confirmation out loud catches the rest.
- `checkCallbackTime(when, leadZone, hours)`: inside agent hours (the `auto_call_*` hours and days, read by `readCallHours`), in the future, within 14 days. Returns ok, or the nearest allowed time to offer.
- `spokenTime(when, leadZone)`: "Thursday at 3 PM your time".

## Done when

- [x] 8 PM is refused with the next morning offered; a weekend is refused with Monday offered - 8 PM Wednesday in Arizona offers Thursday at 11, said "tomorrow at 11 AM your time"; in New York, "tomorrow at 1 PM your time". Saturday at 3 PM in New York offers Monday at 3 PM; Saturday evening, Monday's opening.
- [x] 3 PM in New York is 1 PM in Arizona in winter and **12 PM in summer** (Arizona keeps no daylight saving); the same instant is stored either way - `atLocalTime` gives one instant for both clocks, either side of 2026-03-08 and 2026-11-01.

## Tests

- Area codes in several zones, Arizona, unknown; daylight saving dates; weekends; past times. `src/ai/callback-time.test.ts`, 39 tests: eight zones, the codes across two zones, unknown and malformed numbers, every code listed once under a real zone; wall clocks either side of both clock changes, and seven malformed times refused; in hours, 8 PM, 5 PM, before the opening, a weekend, a weekend evening, 3 PM kept across the clocks going back, summer, past, too soon, too soon at the day's end, two weeks and beyond, other hours and days, no days at all; today, tomorrow, the week, the date beyond, the lead's own clock across midnight, minutes, noon and midnight. 1,119 backend tests in all.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 4.

## Not in this ticket

- Saving the callback (A15).

## As built

- **`checkCallbackTime(when, leadZone, hours, now)`** - `now` is passed in, so the rules stay pure and the tests set the clock. `leadZone` is used only for the offer: a time moved to another day keeps the lead's own clock reading.
- **At least 15 minutes ahead** (`MIN_AHEAD_MINUTES`), not only "in the future": a call back is a real time, and "now" with nobody there is a booking for later. Two refusals, `past` and `too_soon`, so Seri can say which.
- **The offer** is what a salesperson would suggest, not only the nearest instant: a day with no hours (a weekend) keeps the time - Saturday at 3 becomes Monday at 3, the lead's clock; a time outside the hours becomes the next opening - 8 PM tonight becomes 11 tomorrow, 8 AM today's 11; past or too soon, the first quarter hour 15 minutes away (the next opening if the day is over); beyond two weeks, the same time on the last day with hours in reach. Every offer passes the same check. It is null only with no days at all in the settings.
- **`atLocalTime(local, zone)`**, beyond the ticket: reads "2026-11-12T15:00" as a wall clock in a zone - the form `book_callback` will take (A06). Anything not a real date and time, or not a zone, is null.
- **`leadTimeZone` says whether it knew** (`known`): an unknown area code gives Arizona's zone and `known: false`, which A04 turns into Seri asking.
- **353 area codes**, every US state and DC, and Puerto Rico, the Virgin Islands, Guam, the Northern Mariana Islands and American Samoa - each under one zone. A code that spans two goes under the zone most of its people are in: 850 and 448 Central (Pensacola and Panama City; Tallahassee is Eastern), 208 and 986 Mountain (Boise; the panhandle is Pacific), 812 Eastern, 219 Central, 270 Central, 605, 701 and 308 Central, 541 Pacific, 915 Mountain (El Paso, not the rest of Texas). A code added after this list, or a Canadian one, is unknown, so Seri asks.
- **`spokenTime`** says "today", "tomorrow", the day's name within six days, and the day with its date from a week on - "Wednesday, November 18 at 3 PM your time" - so two Wednesdays are never mixed up.
- **Not covered:** holidays - the robot's own hours do not know them either; a lead's zone where their phone is not where they live, which the spoken "your time" confirmation is for.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
