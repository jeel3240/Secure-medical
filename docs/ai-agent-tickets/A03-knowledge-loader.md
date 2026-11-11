# A03 · Knowledge loader

**Goal:** The app loads Seri's three knowledge files at startup and refuses to start if one is broken.

**Why:** A bad file must never reach a live call.

**Depends on:** nothing  ·  **Size:** Small (a few hours)

## Build

- `backend/src/ai/knowledge.ts`: imports `knowledge/answers.json`, `products.json`, `sales-playbook.json` (JSON imports, so they are compiled into `dist/`).
- Checks each file: required fields present, no empty answers, every product has a name and spoken line, all three share one `version`.
- An answer with `status` `needs_confirmation` must have a `fallback_answer`; only that is ever given to Seri.
- `{callback_number}` is the only placeholder an answer may hold; anything else in braces is refused.
- Exports `loadKnowledge()` returning typed data plus the `version`.
- Called at API startup; a failed check stops the API with a clear message naming the file and field.

## Done when

- [ ] A missing field in any file fails a test and stops startup.
- [ ] The production Docker image contains the three files (checked with `docker compose build api`).
- [ ] `loadKnowledge().version` is `approved-2026-11-11`.

## Tests

- Valid files load.
- Each kind of broken file is refused: missing field, empty answer, mismatched versions, an open answer with no `fallback_answer`, an unknown placeholder.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 5 if the rules change.

## Not in this ticket

- Building the instructions (A04).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
