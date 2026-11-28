# B38 · Speak and understand read the pack

**Goal:** Seri's speak and understand steps take the brand, the offer and the
products from the call's pack - and no campaign words are left in their code.

**Why:** `BUCKETS.md`, "Seri with several buckets": one Seri, handed the lead's
bucket's pack; a lead never hears another bucket's offer.

**Depends on:** B37 · **Size:** M · **Status:** To do · **Deploy note:** none.

## Build

- `backend/src/ai/speak.ts`: the persona, the offer line, the products line, the
  opening brief and the opening line built from `pack.campaign`; the functions take
  the pack (the brain already holds the knowledge per call - `ai/brain.ts`).
- `backend/src/ai/understand.ts`: the prompt's brand and the product reason from the
  pack.
- **Proved unchanged:** before the change, a test captures the speak and understand
  prompts built today for a set of moves; after it, the same prompts built from the
  antibiotics pack are byte for byte the same.
- `grep -i "edrugstore\|25%\|antibiotic"` in `backend/src/ai/*.ts` (not tests, evals or
  pack files) finds nothing.

## Done when

- [ ] The before-and-after prompt test passes.
- [ ] `src/ai/speak.test.ts`, `understand.test.ts`, `brain.test.ts` pass, using the
      antibiotics pack.
- [ ] The `grep` above is empty.
- [ ] `npm run ai:eval:speak` and `npm run ai:eval:understand` run once by hand on the
      antibiotics pack - the scores in *As built*, no worse than the last run.

## Tests

As above.

## Docs to update in the same commit

`docs/AI-AGENT.md` (the speak and understand steps), `docs/BUCKETS.md`.

## Not in this ticket

Safety and policy (B39).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
