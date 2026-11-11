# A05 · Sentence safety check

**Goal:** Every sentence Seri is about to say is checked, and a price, medical advice or a made-up discount is replaced.

**Why:** Instructions alone are not enough for a medical business.

**Depends on:** A03  ·  **Size:** Small (a few hours)

## Build

- `backend/src/ai/safety.ts`: `checkSentence(text)` returns the sentence, or the replacement "That's a great question for one of our specialists. Would you like me to connect you?" with the reason.
- Blocks:
  - prices: `$`, digits followed by "dollars" or "bucks", "costs X";
  - dosing and advice: "you should take", "dosage", "mg twice", "take X times a day";
  - diagnosis: "sounds like you have", "you probably have", "you might have" - not "you have" on its own, which is in ordinary sentences ("Do you have a minute?");
  - discounts: any percentage but 25%, and 25% without "up to".
- Allowed: "up to 25% off your first order", product names with strengths as written in `products.json` only when not advising.

## Done when

- [ ] A list of at least 30 sentences (blocked and allowed) passes.
- [ ] **Every sentence of every approved answer, `fallback_answer` and playbook example passes unchanged** (read through A03's loader).
- [ ] Pure, no I/O.

## Tests

- Blocked: prices, dosing, diagnosis, "50% off", "25% off today only". Allowed: the offer line, product names, shipping days, "Do you have a minute?", every approved answer.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 6 if the replacement wording changes.

## Not in this ticket

- Splitting the streamed reply into sentences (A11).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
