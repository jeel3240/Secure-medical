# A28 · Understand: what the lead just said

**Goal:** each thing the lead says becomes a short list of acts - "asks:shipping", "not_interested (timing)", "wants_callback, tomorrow, 2 PM", "checking_line" - quickly and reliably, from a small prompt.

**Why:** the policy (A27) can only be as right as what it is told the lead said. Labelling a line is a much smaller job than following sixty rules, so a small fast model does it well - and its mistakes can be measured on their own.

**Depends on:** A24, A26, A27  ·  **Size:** M  ·  **Status:** To do

## Build

- `backend/src/ai/understand.ts`: the acts as short labels in strict JSON - with `wants_link` (A24: "Just text me the link." had no act of its own); a cached first part (what each act means, the answer ids with sample questions, the objection ids), then her last question, the last few turns and how long after she stopped the words came.
- The time of a call back as the parts the lead said - day, hour, minute, AM/PM - never a date and time worked out by the model.
- A fast path: a bare "yes" or "no" to her open yes-or-no question needs no OpenAI. "Okay" is never on it.
- A labelled set: A21's real lead lines (names made "John") and the answer test set's, each with its expected acts; `npm run ai:eval:understand`.

## Done when

- [ ] At least 99% right on stop, wrong person and wanting a person - the acts that end or move a call - and at least 95% on all acts, over the labelled set.
- [ ] Within A24's time.

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 8 and 12, this tracker, `CLAUDE.md`.
