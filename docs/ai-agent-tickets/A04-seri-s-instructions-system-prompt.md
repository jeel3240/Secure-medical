# A04 · Seri's instructions (system prompt)

**Goal:** One pure function builds the full instructions Seri gets on a call.

**Why:** The instructions are the heart of how Seri talks; they must be testable without OpenAI.

**Depends on:** A03  ·  **Size:** Medium (about a day)

## Build

- `backend/src/ai/instructions.ts`: `buildInstructions({ knowledge, lead, now, hours, callbackNumber })` returns the text. `hours` is what `readCallHours` returns; `callbackNumber` is `TWILIO_PHONE_NUMBER`.
- **The part that never changes first, the call's own details last**, so OpenAI can reuse what it has already read on earlier calls and start faster:
  1. Who Seri is; the goal (a person, then an answer, then the link - the client's order); the call flow (opening, yes, no, questions, "never say I don't know", medical and upset, stop); how to use who is there (`docs/AI-AGENT.md` section 3: someone free or coming → transfer; nobody → offer a call back time); the rules; the sales playbook; every approved answer; the products with **no prices**.
  2. Then, for this call: the agent hours for call backs, today's date and time in Arizona, the lead's first name.
- Who is there is not in the instructions: it changes during the call, so the relay sends it with each turn (A11).
- Lead's first name, or "Hi there" when missing.
- `{callback_number}` filled in, written so it is read digit by digit, as `voicemailLine` does.
- An answer that needs confirmation is given as its `fallback_answer` only.
- Never includes `site_price_usd`.

## Done when

- [ ] Snapshot test of the instructions for a lead with and without a first name.
- [ ] A test proves no price from `products.json` appears anywhere in the text.
- [ ] Every approved answer and every playbook objection is in the text.
- [ ] Two calls for different leads share the same text up to the call's own details.

## Tests

- Snapshot; no prices; all answers present; `medical_web` gives only its `fallback_answer`; the call-back number filled in; the shared prefix.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 3 if the order changes.

## Not in this ticket

- Calling OpenAI (A11).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
