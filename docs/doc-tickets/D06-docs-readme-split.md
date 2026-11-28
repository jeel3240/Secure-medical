# D06 · docs/README.md becomes the index

**Goal:** `docs/README.md` is only the index; running, testing and the environment get their own docs.

**Why:** It holds quick start, troubleshooting, sending, how to test, the environment table, known limits and an architecture section beside the index - with stale facts (test counts 1,634/432 against 1,965/460, "unverified" repeat leads, `EZT_SEND_GROUP` told both unset and set, `DEPLOYMENT.md` still to write) (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** Done 2026-11-27 - `docs/README.md` is the index alone; `RUNNING.md` and `TESTING.md` written; `docs-check --strict` reports no index problem · **Deploy note:** none - documentation only.

## Build

- `docs/RUNNING.md` (How-to): quick start, troubleshooting, sending texts locally - absorbing `CLAUDE.md` §7;
- `docs/TESTING.md` (How-to): every test command - unit, lint, live checks, upgrade checks, speed, e2e, evals - with no counts that drift;
- `docs/ENVIRONMENT.md` (Reference): every environment variable - name, what, required, where set - the one owner; `TWILIO.md` and `AUTO-CALLS.md` link to it;
- Known limits into each owner's Not done (`TWILIO.md`, `STATE-MACHINE.md`, `QUEUE.md`, `POLLER.md`, `LOGGING.md`, `FRONTEND.md`, `AI-AGENT.md`; Redis to `ARCHITECTURE.md`);
- the index: one table - doc · type · owns · update it when - with every doc, the templates and every tickets folder.

## Done when

- [ ] the doc's sections are its type's, in the type's order (`docs/DOCS.md`)
- [ ] no dated note, "As built" or "until" aside left in the body - each is a line in History
- [ ] every fact another doc owns is a link, not a copy
- [ ] every file, function, setting and route it names exists (`grep`)
- [ ] every link resolves, and every code comment that quotes a moved or renamed section is updated
- [ ] nothing lost: each removed sentence is either still true somewhere, or in History

## Tests

The docs check (D47) once it exists; until then `grep` for every name the doc gives, and each link opened.

## Docs to update in the same commit

`docs/README.md`, the three new docs, the owners above.

## Not in this ticket

The root README (D07).

## As built

- `docs/README.md`: one table - Doc · Type · Owns · Update it when - with a row for every doc in `docs/`, the two root maps, the mockup, `templates/` and the four tickets folders, grouped by type. Types are `map`, `architecture`, `area`, `reference`, `how-to`, `review`, `brief`, `standard` - and `phase tickets` for the four folders, `DOCS.md`'s own name for that type (the docs check does not read a folder's type). `node scripts/docs-check.mjs --strict` reports no index problem, and every doc passes its type's sections.
- `docs/RUNNING.md` (how-to): the quick start, stopping, the data, sending texts locally, the EZ Texting subscription, real replies through a tunnel, posting a reply by hand, calls locally, and the local faults - from `docs/README.md`, `CLAUDE.md` §7, and the handoffs from `AUTH.md`, `WEBHOOKS.md` and `FRONTEND.md`.
- `docs/TESTING.md` (how-to): unit and route tests, lint and types, the live checks (`check.ts` and `live-flow.ts` named), the speed check, the end-to-end script, Seri's test sets, walking a flow with one phone (from `FLOWS.md`), real calls, the docs check - no counts that drift. There is no upgrade check yet: B03 plans it.
- `ENVIRONMENT.md` (written by the reference rewriter) linked; the environment table removed.
- Known limits each in its owner's Not done (listed in `docs/README.md`'s History); Redis in `ARCHITECTURE.md`.
- Fixed: the test counts (dropped), "unverified" repeat leads (settled 2026-11-27), `EZT_SEND_GROUP` told both unset and set (one row in `ENVIRONMENT.md`, the steps in `RUNNING.md`), `DEPLOYMENT.md` "still to write" (`DEPLOY.md`, D08).

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
