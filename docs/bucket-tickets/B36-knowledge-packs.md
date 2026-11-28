# B36 · Knowledge packs

**Goal:** Seri's knowledge is a set of packs, one per bucket, each compiled in and
checked at start-up; each call records which pack it used.

**Why:** today three JSON files in `backend/src/ai/knowledge/` are imported statically
(`ai/knowledge.ts`) and loaded once for the process (`api/index.ts`). The production
image carries only what is compiled, so a pack must be in a registry in code - a key in
the database cannot point at a file the build never imported (review, 2026-11-27).
Decision 7 (2026-11-27): a broken pack stops the API, as today.

**Depends on:** B07 · **Size:** M · **Status:** To do · **Deploy note:** additive.

## Build

- The three files move to `backend/src/ai/knowledge/antibiotics/` - unchanged.
- `ai/knowledge.ts`:
  - `PACKS` - a registry, key to the statically imported files;
  - `loadPacks()` - checks every pack with today's `checkKnowledge` at start-up and
    throws on the first broken one, naming the pack;
  - `pack(key)`.
- **Migration:** `buckets.knowledge_key TEXT` (antibiotics `antibiotics`) - empty
  means the bucket has no Seri pack yet, as a new bucket does until B49; its Seri
  cannot be switched on (B35's route and command refuse with `no_pack`);
  `calls.ai_knowledge_key`, with a check beside `calls_ai_started_with_version`: a call
  Seri took records both key and version.
- `api/index.ts`: at start-up, every bucket's `knowledge_key` that is set must be in
  `PACKS`, or the API refuses to start, naming the bucket.
- `ai/relay-store.ts`, `startAiCall`: saves the key with the version. The relay still
  uses the antibiotics pack for every call until B40.

## Done when

- [ ] `src/ai/knowledge.test.ts`: every registered pack passes; a broken pack refused
      with its name; a duplicate key refused.
- [ ] A test of the start-up check: a bucket whose key has no pack stops the start.
- [ ] `scripts/ai-agent-live-check.ts`: a call records its pack's key and version; the
      check refuses one without the key.
- [ ] `npm run e2e` passes.

## Tests

As above.

## Docs to update in the same commit

`docs/AI-AGENT.md` (what she knows: packs), `docs/SCHEMA.md`, `CLAUDE.md` (§4's
`ai/knowledge/` line, §5), `docs/WORKFLOW.md`, `docs/BUCKETS.md` (decision 7: built).

## Not in this ticket

The campaign's words in the pack (B37); a call using its bucket's pack (B40).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
