# B37 · The campaign in the pack

**Goal:** everything that makes Seri antibiotics' - the brand, how she introduces
herself, the offer and its percentage, the products line, the product objection - is
data in the pack, with antibiotics' values exactly as they are in the code today.

**Why:** the brand and offer are hard-coded in Seri's code, not only in the knowledge
files (survey, 2026-11-27): `ai/speak.ts` (the persona, "up to 25% off your first
order", the products line, the opening brief, `OPENING_LINE`), `ai/understand.ts` (the
prompt's brand, the "not antibiotics" reason), `ai/safety.ts` (only 25 allowed),
`ai/policy.ts` (objection and topic ids), `ai/knowledge.ts` (the product types).

**Depends on:** B36 · **Size:** S · **Status:** To do · **Deploy note:** none - data,
no reader yet.

## Build

- `backend/src/ai/knowledge/antibiotics/campaign.json`: `brand`, `assistant`, the
  intro and opening lines, `offer_line`, `offer_percentage`, `products_line`,
  `product_objection` (the id now hard-coded as `dont_need_antibiotics`),
  `product_types` - each value **copied exactly** from the code it will replace, with
  where it came from listed in this ticket's PR.
- `ai/knowledge.ts`: the campaign checked with the pack - every field present;
  `offer_percentage` a whole number from 1 to 100; `offer_line` contains it; the
  objection id exists in the pack's playbook; the product types match the products.
- A test that pins it: antibiotics' campaign values equal today's constants -
  written **before** B38 and B39 remove those constants, so the move is proved
  word for word.

## Done when

- [ ] `src/ai/knowledge.test.ts`: the campaign checks, each refusal.
- [ ] The pinning test passes.
- [ ] Jeel has read the campaign file - it changes no words.

## Tests

The unit tests.

## Docs to update in the same commit

`docs/AI-AGENT.md` (what she knows: the campaign), `docs/BUCKETS.md`.

## Not in this ticket

Reading it (B38, B39).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
