# A03 · Knowledge loader

**Goal:** The app loads Seri's three knowledge files at startup and refuses to start if one is broken.

**Why:** A bad file must never reach a live call.

**Depends on:** nothing  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-11

## Build

- `backend/src/ai/knowledge.ts`: imports `knowledge/answers.json`, `products.json`, `sales-playbook.json` (JSON imports, so they are compiled into `dist/`).
- Checks each file: required fields present, no empty answers, every product has a name and spoken line, all three share one `version`.
- An answer with `status` `needs_confirmation` must have a `fallback_answer`; only that is ever given to Seri.
- `{callback_number}` is the only placeholder an answer may hold; anything else in braces is refused.
- Exports `loadKnowledge()` returning typed data plus the `version`.
- Called at API startup; a failed check stops the API with a clear message naming the file and field.

## Done when

- [x] A missing field in any file fails a test and stops startup - tested in each of the three files; and the compiled API, started with `price`'s answer taken out, logged `api.refused_start` with `answers.json: answers[id=price].answer is missing` and exited 1. Intact, it started and logged `knowledge: approved-2026-11-11`.
- [x] The production Docker image contains the three files (checked with `docker compose build api`): `dist/ai/knowledge/` holds all three, and `loadKnowledge()` reads them there.
- [x] `loadKnowledge().version` is `approved-2026-11-11` - `approved-2026-11-12` since four speaking-style lines were added the next day (b58f583).

## Tests

- Valid files load: 10 rules, 37 answers, 30 products, 9 objections, 3 closing questions; no price anywhere; `medical_web` gives only its fallback; `{callback_number}` kept for A04; checked once and kept.
- Each kind of broken file is refused: missing field, empty answer, mismatched versions, an open answer with no `fallback_answer`, an unknown placeholder - and an id or slug used twice, a value not in its list, a URL that is not `https://`, a file missing or not an object. Every problem is listed, not only the first (16 tests; 1,080 backend tests in all).

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 5 if the rules change.

## Not in this ticket

- Building the instructions (A04).

## As built

- **Prices are dropped by the loader**, not only left out of the instructions: a typed product has no field for `site_price_usd`, so nothing after this file can say one.
- **An answer's `spoken`** is what Seri may say - the answer once `approved`, its `fallback_answer` while it `needs_confirmation` - so A04 cannot pick the unconfirmed text by mistake.
- The placeholder rule covers every line Seri may say: answers, fallbacks, products' spoken lines, the playbook's examples and closing questions.
- The check runs **whether or not the AI agent is on**: the files are in the repo, so a broken one is a bug, found on the first start rather than at the switch-on.
- `api.started` names the knowledge version, so the version a running server holds is in its logs.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
