# A04 · Seri's instructions (system prompt)

**Goal:** One pure function builds the full instructions Seri gets on a call.

**Why:** The instructions are the heart of how Seri talks; they must be testable without OpenAI.

**Depends on:** A03  ·  **Size:** Medium (about a day)  ·  **Status:** Done 2026-11-11

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

- [x] Snapshot test of the instructions for a lead with and without a first name - `src/ai/__snapshots__/instructions.test.ts.snap`.
- [x] A test proves no price from `products.json` appears anywhere in the text - each of the 25 prices, as written and as "39 dollars", no `$`, and no product's web address.
- [x] Every approved answer and every playbook objection is in the text - all 36 approved answers, the 9 objections, the closing questions, every rule and "never", and every product's spoken line.
- [x] Two calls for different leads share the same text up to the call's own details - a lead with a name in New York and one with none and an unknown area code, on different days and hours: the same first 18,000 characters, word for word.

## Tests

- Snapshot; no prices; all answers present; `medical_web` gives only its `fallback_answer`; the call-back number filled in; the shared prefix. `src/ai/instructions.test.ts`, 35 tests: also the stop line, the three notes of who is there and none set in the call's part, the call's part line by line, no name, an unknown area code, a lead in Arizona, summer, a day with no hours, other hours and days; the first name cleaned in 17 cases; the greeting. 1,154 backend tests in all.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 3 if the order changes.

## Not in this ticket

- Calling OpenAI (A11).

## As built

- **`buildInstructions` also takes `stopLine`**, the script's own stop line (`call_scripts.opt_out_body`): section 3 has Seri say it as her last line on an opt-out, so it is read from the script rather than copied.
- **The call's part says more than the ticket listed:** the greeting she has already said; today's date and time in Arizona, and the date as `2026-11-11` for `book_callback` (A06); **the lead's time zone** from the area code (A07), with the time there now - or, from a number that tells us nothing, an instruction to ask where they are and Arizona's time until then; and the agent hours, also in the lead's own time today ("today, 1 PM to 7 PM the lead's time"), or "Today has none".
- **Who is there is defined here, for the relay:** `WhoIsThere` (`free`, `coming`, `nobody`) and `whoIsThereNote` - "[Who is there: someone free]" - which the relay puts before each of the lead's turns (A11). The instructions explain the three notes and tell Seri never to read them out.
- **`welcomeGreeting(firstName)`** is here too, so what Twilio says first (A13) and what Seri is told she said are the same text: "Hi, is this John?", or "Hi there!" with no name.
- **The first name is cleaned** (`cleanFirstName`): letters, with spaces, hyphens, apostrophes and dots between, at most 30 long; "JOHN" and "john" become "John"; anything else - "TEST123", a sentence typed into a form - is no name, so nothing a lead typed reaches the instructions as words to follow.
- **Two lines not in the knowledge files:** asked whether she is a real person, Seri says honestly that she is eDrugstore's virtual assistant and offers a person - **approved by Jeel, 2026-11-11**; and, still for Jeel to confirm, an example opening - "This is Seri from eDrugstore. You signed up on one of our partner sites, and I'm calling about our offer of up to 25% off your first order. Is that something you'd be interested in?" - built from approved answers. The playbook's "The client's answer" is explained as "say the example as written".
- **Products:** each name for reference, and the spoken line to say. No price, no web address: the link goes by text.
- **Size:** about 3,300 words, 18,800 characters - the shared part over 18,000 of them, well past the 1,024 tokens OpenAI needs before it reuses a prompt.
- **One rule for reading a number out:** `spokenNumber` was taken out of `voicemailLine` (`core/call-script.ts`), so the voicemail and Seri say a number the same way; and `spokenClock` out of `spokenTime` (A07).
- **The repo's first snapshot test.** A change to a knowledge file or to the wording fails it, so the PR shows the new instructions; after reading the difference, `npx jest -u src/ai/instructions` writes the new one.

- **Changed by A09 (the answer test set), 2026-11-11:** the last line and the action in the same reply, never after a question; only agree call-back times inside the agent hours; never talk about doses, frequency, side effects or interactions; opt out at once, without offering or asking; and the call's details give tomorrow's date and the days with no agent hours ("Monday to Friday - never Saturday or Sunday"). The snapshot was rewritten after reading the difference.
- **Changed 2026-11-12, four lines on speaking like a person** - contractions, varied words, a small first word now and then but never "um", and the tone to suit the moment. They are in `sales-playbook.json`'s `style`, not in the code, so the snapshot changed by exactly those four lines; the version is now `approved-2026-11-12`. Why, and the answer test set before and after: `docs/AI-AGENT.md` section 1, "Her words, not only her voice".
- **Changed 2026-11-13, after A21's first real calls** - a "How you sound" part (seven tones from `ai/tone.ts`, one at the start of every reply, businesslike, never flirty or breathy; brackets for tones only, actions never written); the opening without "You signed up on one of our partner sites"; offering to connect not after every answer, and the closing questions only in their situation. `docs/AI-AGENT.md` section 1, "Her voice and tone".

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
