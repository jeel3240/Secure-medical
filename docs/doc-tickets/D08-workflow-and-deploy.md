# D08 · WORKFLOW.md and DEPLOY.md

**Goal:** `WORKFLOW.md` is branches, PRs and migrations; a new `DEPLOY.md` is the server: deploying, the images, switches, `twilio:configure`, CloudWatch, the start-up refusals, and what to do when it goes wrong.

**Why:** `WORKFLOW.md` mixes both with 21 dates; it calls the EZ Texting account live in one place and test in another; one deploy command lacks the `-f` files (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- `WORKFLOW.md` (How-to): before you start, branch → PR → merge, migrations (the rule, "Where the files stand" as its one owner), the definition of done, History;
- `DEPLOY.md` (How-to): the steps (B02's order once built), the images, Seri's and the buckets' switches, `twilio:configure`, CloudWatch, the resend after an outage (from `POLLER.md`), "When it goes wrong" (from `LOGGING.md`'s "goes quiet");
- the credentials table to `CLAUDE.md`'s rules and `EZTEXTING-API.md`;
- every deploy command with both `-f` files.

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

`WORKFLOW.md`, `DEPLOY.md`, `POLLER.md`, `LOGGING.md`, `docs/README.md`, the A22 and B46 tickets where they give commands.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
