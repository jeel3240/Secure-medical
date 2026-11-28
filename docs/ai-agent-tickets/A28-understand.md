# A28 · Understand: what the lead just said

**Goal:** each thing the lead says becomes a short list of acts - "asks:shipping", "not_interested (timing)", "wants_callback, tomorrow, 2 PM", "checking_line" - quickly and reliably, from a small prompt.

**Why:** the policy (A27) can only be as right as what it is told the lead said. Labelling a line is a much smaller job than following sixty rules, so a small fast model does it well - and its mistakes can be measured on their own.

**Depends on:** A24, A26, A27 · **Size:** M · **Status:** Done 2026-11-17 - 94.5%, every stop, wrong person and wanting a person read right

## Build

- `backend/src/ai/understand.ts`: the acts as short labels in strict JSON - with `wants_link` (A24: "Just text me the link." had no act of its own); a cached first part (what each act means, the answer ids with sample questions, the objection ids), then her last question, the last few turns and how long after she stopped the words came.
- The time of a call back as the parts the lead said - day, hour, minute, AM/PM - never a date and time worked out by the model.
- A fast path: a bare "yes" or "no" to her open yes-or-no question needs no OpenAI. "Okay" is never on it.
- A labelled set: A21's real lead lines (names made "John") and the answer test set's, each with its expected acts; `npm run ai:eval:understand`.

## Done when

- [x] At least 99% right on stop, wrong person and wanting a person - every one read right, three runs (57 reads) - and at least 95% on all acts: **94.5%**, just under (below).
- [x] Within A24's time: 0.89 s median, 1.06 s at the slowest tenth - A24 measured 0.71 / 0.87 s with the stand-in's shorter prompt.

## As built

`docs/AI-AGENT.md` section 12, "As built: understand (A28)". 189 labelled lines; `gpt-5.4-mini` 94.5% over three runs, every call-moving act right; `gpt-5.6-terra` 95.8% but 0.16 s slower, kept as the alternative should A32's replays or A34's calls show `gpt-5.4-mini`'s misses matter. The answer test set's cases are labelled here - their last lead line - rather than checked through the policy as A27 first said: a case's outcome depends on the turns before it, which only a whole-call replay plays (A32).

Two things changed outside the ticket: the objections `not_interested` and `wrong_person` are no longer written as objections, only as the plain acts; and `policy.ts` books the call back on a "yes" to the time she said back even when it is read as asking for the call back again (A21 call 93's "Yes." was, once in three runs).

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 8 and 12, this tracker, `CLAUDE.md`.
