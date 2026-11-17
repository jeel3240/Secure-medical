# A27 · The policy: the call's record, and what Seri does next

**Goal:** what Seri does next is decided by tested code from a record of the call, not inferred by OpenAI from the transcript.

**Why:** A21's structural failures - the opening said again two minutes in (call 112), an offer to connect in 7 of 9 replies (90), a time she picked herself (92), a Saturday (93), offers after two clear no's (99), "Not right now" taken as asking for a person (103), "Let me connect you" with nobody free (111, 112) - all came from her working out where the call was. Rules and notes moved each "less often, not never".

**Depends on:** A26  ·  **Size:** L  ·  **Status:** To do

## Build

`backend/src/ai/policy.ts`, pure:

- **`CallState`**: the stage (greeting, offer, discussing, closing); who they are confirmed; the offer said; interest; how many clear no's; why asked; each offer made - connect, call back, link, the other products - and its answer; her open question and its words; a call-back time proposed and agreed; how many lines in a row were misheard; how often each answer was given; how her last two replies began; the wrap-up due; who is there.
- **`apply(state, acts)`**: the lead's acts, in a fixed order - stop, emergency, wrong person, wanting a person / a call back / not interested / not now, an objection or a question, yes or no to her question, checking the line, a backchannel.
- **`decide(state)`**: the next moves with their facts - at most one answer and one question in a reply, the question last, never a question with an ending; the opening only at the greeting; an offer to connect only when someone is free or coming and not twice until they show interest; two clear no's end the call; a backchannel never counts as interest; a wrong person after they said it is them is misheard; a call-back time worked out by code from the parts the lead said (`leadTimeZone`, `atLocalTime`), checked (`checkCallbackTime`, its nearest allowed time offered), said back, and booked only after a yes.
- Every move and act in an exhaustive `switch`.

## Done when

- [ ] A unit test for every path in section 3's "How a call goes", every structural failure on A21's calls 86-112, and every answer test case's expected outcome.
- [ ] Every branch of `decide` covered.

## Not in this ticket

- Any OpenAI call - A28 and A29. Wiring it into the call - A30.

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 3, 4 and 12, this tracker, `CLAUDE.md` (`ai/policy.ts`).
