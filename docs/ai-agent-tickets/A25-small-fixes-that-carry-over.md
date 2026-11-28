# A25 · Small fixes that carry over

**Goal:** two things the new brain keeps are fixed first: the silence is counted even when Twilio says the lead is talking but no words come, and the safety line never offers to connect anyone when nobody is free.

**Why:** call 112 - "are you still there?" came about 13 seconds after her question, not 6: the silence only counts while nobody talks, and Twilio's speaker events showed the lead talking with no words. And `SPECIALIST_LINE` (`safety.ts`) asks "Would you like me to connect you?" whoever is there - the same fault as call 111's specialist line.

**Depends on:** A24 · **Size:** S · **Status:** Done 2026-11-17 - silence held, not started again; the specialist line by who is there

## Build

- `conversation.ts`: "the lead is talking" stops the silence for at most about 4 seconds without any words; then the silence counts as if nobody spoke.
- `safety.ts`: `specialistLine(who)` - with nobody free, the specialist line asks when a call back would suit, never "connect you".

## Done when

- [x] Fake-clock tests: the lead "talking" with no words for 4 seconds, then silence → "are you still there?" on time; words still reset it as today.
- [x] Tests: with nobody free, a replaced sentence never says "connect"; with someone free or coming, it offers to.

## As built

- **The silence was being started again, not just held.** The design already stopped it while Twilio said the lead was talking (A12); the fault was that `clientSpeaking` off, with no words, began the 6 seconds afresh - so each noise or dropped "mm" after her question put "are you still there?" further off. Now the lead "talking" holds the silence and it counts on from where it was (`holdSilence`, `countSilence`); a `clientSpeaking` on with no off and no words holds it 4 seconds at most (`LIMITS.noWordsMs`). Her own talking, the lead's words and a key still start it afresh, as before. Call 112's 13 seconds cannot be proven this was the cause - speaker events were not recorded - so `ai_relay.still_there` now carries `heldMs`, how long noises held that silence; A34's calls will show it.
- `Timers` gained `now()` (the fake clock's own time), for what is left of a held silence.
- **The specialist line:** `specialistLine(who)` - with nobody to take a call, "That's a great question for one of our specialists. Everyone on our team is busy right now - when would be a good time for one of them to call you back?"; with someone free or coming, `SPECIALIST_LINE` as before. A relay line, fixed like "One moment...": it replaces a sentence that cannot be said. `checkSentence` still only decides whether a sentence can be said.
- **Not changed:** the specialist line quoted in her instructions ("Let me connect you with one of our specialists who can help with that.", `instructions.ts`) - the new brain's speak step (A29) words the specialist move by who is there, and the instructions go with today's brain (A30).
- Tests: four new silence tests, the three-minute tests now keep Twilio saying her line rather than the lead "talking" for minutes (which now counts as silence after 4 seconds), two for the specialist line; 606 AI tests.

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 5 (the safety check) and 6 (silence), this tracker.
