# D48 · The last sweep

**Goal:** Every doc meets the standard, and the check proves it.

**Why:** The closing ticket: what slipped between the others.

**Depends on:** every other D-ticket · **Size:** S · **Status:** Done 2026-11-27 - `npm run docs:check --strict` passes on all 210 docs; every ticket Done · **Deploy note:** none - documentation only.

## Build

- `npm run docs:check` clean over the whole repo; each fact still owned once (a pass for repeats the per-doc tickets missed); `docs/README.md`'s table complete; the tracker closed - every row Done.

## Done when

- [ ] the docs check passes;
- [ ] every row of this tracker is Done.

## Tests

The docs check (D47) once it exists; until then `grep` for every name the doc gives, and each link opened.

## Docs to update in the same commit

`docs/README.md`'s table if a doc is added, renamed or its type changes; the tracker's row.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

- **Code follows the docs.** About 70 code comments quoted doc sections that moved (AUTO-CALLS.md's into AUTO-CALL-TRANSFER.md and AUTO-CALL-SCRIPT.md, TWILIO.md's into INCOMING-CALLS.md and TWILIO-SETUP.md, AI-AGENT.md section 12 into AI-BRAIN.md, CLAUDE.md §2/§6/§10 into their owners, the resend steps into DEPLOY.md) or described removed code (the first brain, Seri asking for a time zone, the old repeat-lead plan); all re-pointed, plus one runtime message (`ezt-client.ts`, `EZT_SEND_GROUP`), the Dockerfile, the compose file, `live-checks.sh` and the e2e. Comments only; migrations untouched.
- **The docs check gained a `refs` rule**: every `DOC.md, "Section"` in a doc, in a ticket not yet done, or in a code comment, Dockerfile, compose file or the Caddyfile names a heading that exists - so a moved section can no longer leave a dangling pointer. History sections and finished tickets keep the names of their day.
- **Bucket tickets** (to do) re-pointed: no more "CLAUDE.md §5" (now SCHEMA's History and WORKFLOW's "Where the files stand"); the robot's script to AUTO-CALL-SCRIPT.md, a missed call to INCOMING-CALLS.md, knowledge packs to AI-KNOWLEDGE.md, the Seri command to DEPLOY.md, "How to test" to TESTING.md.
- **Proved:** `node scripts/docs-check.mjs --strict` clean (210 docs and every code reference), its self-test, backend 1,965 and frontend 460 tests, lint and both type checks.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
