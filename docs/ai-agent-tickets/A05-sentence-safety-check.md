# A05 · Sentence safety check

**Goal:** Every sentence Seri is about to say is checked, and a price, medical advice or a made-up discount is replaced.

**Why:** Instructions alone are not enough for a medical business.

**Depends on:** A03  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-11

## Build

- `backend/src/ai/safety.ts`: `checkSentence(text)` returns the sentence, or the replacement "That's a great question for one of our specialists. Would you like me to connect you?" with the reason.
- Blocks:
  - prices: `$`, digits followed by "dollars" or "bucks", "costs X";
  - dosing and advice: "you should take", "dosage", "mg twice", "take X times a day";
  - diagnosis: "sounds like you have", "you probably have", "you might have" - not "you have" on its own, which is in ordinary sentences ("Do you have a minute?");
  - discounts: any percentage but 25%, and 25% without "up to".
- Allowed: "up to 25% off your first order", product names with strengths as written in `products.json` only when not advising.

## Done when

- [x] A list of at least 30 sentences (blocked and allowed) passes - 36 blocked, each with its reason, and 21 allowed.
- [x] **Every sentence of every approved answer, `fallback_answer` and playbook example passes unchanged** (read through A03's loader) - 116 lines whole and sentence by sentence: every answer as Seri gets it, every answer as written (`medical_web`'s own too, so it passes once approved), every product's spoken line, the objections' examples and the closing questions; and the lines her instructions give her - the opening example, the specialist line, "Great, connecting you now.", the stop line, the greetings, a call-back time said back.
- [x] Pure, no I/O.

## Tests

- Blocked: prices, dosing, diagnosis, "50% off", "25% off today only". Allowed: the offer line, product names, shipping days, "Do you have a minute?", every approved answer. `src/ai/safety.test.ts`, 184 tests; 1,338 backend tests in all.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 6 if the replacement wording changes.

## Not in this ticket

- Splitting the streamed reply into sentences (A11).

## As built

- **`checkSentence(sentence)` returns `{ say, reason, found }`**: what Seri says - the sentence, or `SPECIALIST_LINE`, the ticket's wording - why it was replaced (`price`, `advice`, `diagnosis` or `discount`, or null), and the words found, for the call's own record in `call_ai_turns` (A11). The words never go to the logs.
- **More than the ticket's list**, each in the tests: a price as "cents", "39.00", "30 a month", "prices start at 25"; advice as a cream applied "before bed", "you need to take the whole course", "I suggest you take", side effects, "safe to take", interactions; a diagnosis as "you could be infected" or "you have an infection"; a discount as a number in words ("twenty-five percent", "fifty percent"), half off, buy one get one, and made-up urgency - "today only", "ends tonight", "act now" - which the playbook forbids with made-up discounts.
- **The words around a risky word decide, not the word alone**, so the approved lines pass: "once", "twice", "a day", "with food" are advice only beside a medicine word (take, tablet, mg, dose, apply, cream); "you might have" is a diagnosis only when an illness follows within two words ("you might have seen our text" passes); "suggest" and "recommend" only before taking or using; "dose" only as a word ("an overdose" passes). "Do you have a minute?" and "so you have it when you're ready" pass.
- **Not covered:** a price said in words with no money word ("it's thirty-nine ninety-nine"), and anything the words do not show. The check reads what is written, not what it means: the instructions forbid it in the first place, and the answer test set (A09) checks what she actually says.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
