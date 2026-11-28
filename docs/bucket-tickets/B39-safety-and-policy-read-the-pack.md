# B39 · Safety and policy read the pack

**Goal:** the safety check allows the pack's own offer percentage, and the policy's
ids come from the pack, with the ids every pack must have checked at start-up.

**Why:** `backend/src/ai/safety.ts` (`wrongPercentage`) blocks any percentage but 25;
`backend/src/ai/policy.ts` names objection and topic ids in code
(`OBJECTION_ANSWERS`, `WORDED_OBJECTIONS`, `OPENING_TOPICS`, `HEALTH_ANSWERS`, the
products offer, `dont_need_antibiotics`).

**Depends on:** B37 · **Size:** S · **Status:** To do · **Deploy note:** none.

## Build

- `safety.ts`: `wrongPercentage` allows the pack's `offer_percentage`. The specialist
  lines and the medical-word list stay shared - they name no brand.
- `policy.ts`: the product objection from `pack.campaign.product_objection`; a
  `REQUIRED_IDS` list in code - the answer, objection and topic ids the policy relies
  on - and `ai/knowledge.ts` refuses a pack missing any of them.
- Proved unchanged for antibiotics, as in B38: today's decisions on the existing
  policy tests are the same with the pack.

## Done when

- [ ] `src/ai/safety.test.ts`: a pack at 30% allows 30 and blocks 25; antibiotics
      unchanged.
- [ ] `src/ai/policy.test.ts`: every existing case passes with the pack; the product
      objection from the pack.
- [ ] `src/ai/knowledge.test.ts`: a pack missing a required id refused, naming it.

## Tests

The unit tests.

## Docs to update in the same commit

`docs/AI-AGENT.md` (safety, the decide step), `docs/BUCKETS.md`.

## Not in this ticket

Choosing the pack per call (B40).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
