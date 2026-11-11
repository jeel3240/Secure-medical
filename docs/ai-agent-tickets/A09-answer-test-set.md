# A09 · Answer test set

**Goal:** About 60 things leads say, each with what Seri must do, run against the real model.

**Why:** The only safe way to change instructions or knowledge without breaking something.

**Depends on:** A04, A05, A06  ·  **Size:** Medium (about a day)

## Build

- `backend/src/ai/evals/cases.json`: each case is a short conversation, the action that must follow (or none yet), and words that must not appear.
- Cover: yes now, yes later, no, two no's, every objection in the playbook, price, scam, insurance, medical question, upset, unknown question, "stop", wrong person, "call me at 9 PM", silence-like replies.
- `npm run ai:eval`: runs every case against OpenAI with the real instructions and tools, prints pass or fail per case, and time to first word.
- Pick the model: run with two or three small fast models; choose by pass rate, then speed. Write the choice in `docs/AI-AGENT.md` section 1.

## Done when

- [ ] At least 95% of cases pass with the chosen model; every failure is understood and written down.
- [ ] The chosen model and its typical time to first word are recorded.

## Tests

- This ticket is the test.

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 1 and 8.

## Not in this ticket

- Running it in CI (it calls OpenAI and costs money: run by hand before each change).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
