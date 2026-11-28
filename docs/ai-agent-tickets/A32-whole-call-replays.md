# A32 · Whole-call replays

**Goal:** every real test call is played again through the real conversation, with the real OpenAI, before anyone picks up a phone.

**Why:** the answer test set asks one reply at a time; A21's failures showed up across turns - an offer repeated, a third offer after two no's, the opening said again. A replay finds those in minutes.

**Depends on:** A30, A31 · **Size:** M · **Status:** Done 2026-11-17 - 238 of 240 replays held every rule

## Build

- A replay: each real call's lead lines (names made "John"), fed in order to the real `Conversation`, a fake Twilio, the real OpenAI; what she said, did and ended with checked against rules that hold on every call.

## Done when

- [x] Every structural A21 failure passes 10 of 10: the opening never said twice, no offer to connect twice in a row or with nobody free, two clear no's end the call, no call back booked for a time not said back and agreed - 240 of 240.
- [x] The rest at least 9 of 10, each miss written down: 238 of 240 - the two said "not able to connect you" with nobody free, a fact, not an offer; the brief changed (section 12).

## As built

`docs/AI-AGENT.md` section 12, "As built: whole-call replays (A32)". 24 calls (call 87 had no lead line), ten runs each, 2026-11-17: 238 of 240 held every rule, every structural rule 240 of 240. The real lines are read from a local export (`--real`), never committed. Two wording changes came from reading the replays: the opening no longer greets again, and after an approved answer she goes straight on without repeating any of it.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 8, this tracker, `CLAUDE.md`.
