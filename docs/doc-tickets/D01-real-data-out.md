# D01 · Real data out of the docs

**Goal:** No committed doc or test holds a real person's phone number, a real contact's name, a tester's handle or production's domain.

**Why:** The docs audit of 2026-11-27 found: a real contact copied from the client's EZ Texting account (a phone number and a name) in `EZTEXTING-API.md` (about lines 91-93); a real-format handset number, `16026203572`, in `EZTEXTING-API.md`, `AUDIT.md`, `STATE-MACHINE.md`, `WEBHOOKS.md`, `QUEUE.md`, `ADMIN-LEADS.md` and tests such as `backend/src/integrations/ezt-client.test.ts`; the account's sending number, `15207799209`; the handle "karm" about 80 times across `AUTO-CALLS.md`, `ADMIN.md`, `ADMIN-LEADS.md`, `LEAD-FLOW.md`, `FRONTEND.md` and in `frontend/src/pages/admin/OverviewPage.tsx`; production's domain in `AUTO-CALLS.md` and `TWILIO.md`. `DOCS.md` rules 5 and 8. First, before any other doc ticket.

**Depends on:** - · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- every real phone number replaced with a 555 number of the same shape (`+1602555xxxx`), in docs **and** tests - one fake per real number, used consistently, so tests that compare numbers still pass;
- the real contact replaced with an invented one, the field shapes kept;
- "karm" replaced with an invented agent name, the same one everywhere it stood for the same person; the comment in `OverviewPage.tsx` too;
- production's domain replaced with "production's domain" - it lives in the server's `.env`, not the docs;
- a line at the top of the fixture names in `DOCS.md`: the invented names in use (Maya Chen, Dana, John, Priya, Leo, Casey, Riley, Avery, and the replacement for "karm") are invented;
- **git history still holds the old text.** Removing it from history means rewriting `dev` and `main` and a force push - Jeel's decision, asked in this ticket's PR, not done by it.

## Done when

- [ ] `grep -rn` for each real number, the contact's name, "karm" and the domain over `docs/`, `CLAUDE.md`, `README.md`, `backend/` and `frontend/` (excluding `node_modules`) finds nothing;
- [ ] backend `npm test` and frontend `npm test` pass; `scripts/live-checks.sh` passes;
- [ ] Jeel's answer on rewriting history recorded under *As built*.

## Tests

The two `npm test` runs and the live checks - test fixtures change; the `grep` over the whole repo.

## Docs to update in the same commit

`docs/DOCS.md` (the invented names); every doc touched above.

## Not in this ticket

Restructuring any of those docs.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
