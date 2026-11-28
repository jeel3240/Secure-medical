# D47 · A docs check

**Goal:** One command checks the docs: every link resolves, every file a doc names exists, no forbidden name or number appears, and each doc's headings are its type's.

**Why:** The audit found broken pointers, renamed files, stale counts and real data that no one noticed for weeks. A check that runs keeps the standard from drifting.

**Depends on:** D01 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- `scripts/docs-check.mjs` at the repo root (plain Node, no dependencies), run with `npm run docs:check` from `backend/`:
-   - every relative link and every backticked `docs/...md` or `backend/...`/`frontend/...` path exists;
-   - no phone number outside an allowed list (the 555 range, the dev and production Twilio numbers), no name or domain from a forbidden list (kept as hashes, so the check does not itself hold them);
-   - each doc's type from `docs/README.md`'s table, and its `##` headings a subsequence of the type's order (`DOCS.md`);
-   - no dated aside - `*(20` - outside a History section;
- documented in `TESTING.md`; listed in the tracker gates; a ticket's *Done when* runs it.

## Done when

- [ ] it passes on a doc that meets the standard and fails, naming the line, on each kind of fault (seen once each);
- [ ] it runs in under a few seconds.

## Tests

The check itself, run against a fixture doc for each fault.

## Docs to update in the same commit

`docs/README.md`'s table if a doc is added, renamed or its type changes; the tracker's row.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
