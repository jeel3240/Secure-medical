# A25 · Small fixes that carry over

**Goal:** two things the new brain keeps are fixed first: the silence is counted even when Twilio says the lead is talking but no words come, and the safety line never offers to connect anyone when nobody is free.

**Why:** call 112 - "are you still there?" came about 13 seconds after her question, not 6: the silence only counts while nobody talks, and Twilio's speaker events showed the lead talking with no words. And `SPECIALIST_LINE` (`safety.ts`) asks "Would you like me to connect you?" whoever is there - the same fault as call 111's specialist line.

**Depends on:** A24  ·  **Size:** S  ·  **Status:** To do

## Build

- `conversation.ts`: "the lead is talking" stops the silence for at most about 4 seconds without any words; then the silence counts as if nobody spoke.
- `safety.ts`: `specialistLine(who)` - with nobody free, the specialist line asks when a call back would suit, never "connect you".

## Done when

- [ ] Fake-clock tests: the lead "talking" with no words for 4 seconds, then silence → "are you still there?" on time; words still reset it as today.
- [ ] Tests: with nobody free, a replaced sentence never says "connect"; with someone free or coming, it offers to.

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 5 (the safety check) and 6 (silence), this tracker.
