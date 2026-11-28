# D01 · Real data out of the docs

**Goal:** No committed doc or test holds a real person's phone number, a real contact's name, a tester's handle or production's domain.

**Why:** The docs audit of 2026-11-27 found real data in committed files: a real contact copied from the client's EZ Texting account (a phone number and a name) in `EZTEXTING-API.md`; a real handset number in seven docs, a code comment and five test files; the account's sending number in a doc, a code comment, a test and the e2e; a tester's real handle about 70 times across `AUTO-CALLS.md`, `ADMIN.md`, `ADMIN-LEADS.md`, `LEAD-FLOW.md`, `FRONTEND.md`, a frontend comment and five test files; production's domain in `AUTO-CALLS.md`, `TWILIO.md`, `.env.example` and two tests. `DOCS.md` rules 5 and 8. First, before any other doc ticket. The values are not repeated here.

**Depends on:** - · **Size:** S · **Status:** Done 2026-11-27 - nothing real left in the repo but `caddy/Caddyfile`'s domain · **Deploy note:** none - documentation only.

## Build

- every real phone number replaced with a 555 number of the same shape (`+1602555xxxx`), in docs **and** tests - one fake per real number, used consistently, so tests that compare numbers still pass;
- the real contact replaced with an invented one, the field shapes kept;
- "nora" replaced with an invented agent name, the same one everywhere it stood for the same person; the comment in `OverviewPage.tsx` too;
- production's domain replaced with "production's domain" in docs and `.env.example`, and an example domain in tests - it stays only in `caddy/Caddyfile`, which the site needs;
- a line at the top of the fixture names in `DOCS.md`: the invented names in use (Maya Chen, Dana, John, Priya, Leo, Casey, Riley, Avery, and the replacement for "nora") are invented;
- **git history still holds the old text.** Removing it from history means rewriting `dev` and `main` and a force push - Jeel's decision, asked in this ticket's PR, not done by it.

## Done when

- [ ] `grep -rn` for each real number, the contact's name, "nora" and the domain over `docs/`, `CLAUDE.md`, `README.md`, `backend/` and `frontend/` (excluding `node_modules`) finds nothing;
- [ ] backend `npm test` and frontend `npm test` pass; `scripts/live-checks.sh` passes;
- [ ] Jeel's answer on rewriting history recorded under *As built*.

## Tests

The two `npm test` runs and the live checks - test fixtures change; the `grep` over the whole repo.

## Docs to update in the same commit

`docs/DOCS.md` (the invented names); every doc touched above.

## Not in this ticket

Restructuring any of those docs.

## As built

- Replaced in 30 files: seven docs, two code comments (`backend/src/db/sql.ts`, `backend/src/api/webhooks.ts`), a frontend comment, test fixtures in backend and frontend, the e2e and `.env.example`. The invented values: the handset `+16025550147`, the contact `jamie rivera` at `15125550163`, the sending number `15205550109`, the agent Nora, and `leads.example.com` in tests.
- The domain stays in `caddy/Caddyfile`: Caddy needs it to serve the site.
- Proved: backend 1,965 tests, frontend 460, every one of the 23 live checks, the e2e's 142 checks; `grep` over the repo finds none of the old values.
- **Git history still holds the old text** - removing it needs a rewrite of `dev` and `main` and a force push: Jeel's decision, asked at the merge.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
