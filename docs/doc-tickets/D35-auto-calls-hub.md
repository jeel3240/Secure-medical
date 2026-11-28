# D35 · AUTO-CALLS.md, the hub

**Goal:** `AUTO-CALLS.md` is an area doc of about 450 lines: who is called and when, traffic, Twilio refusing, how a call is placed, the webhooks, what is saved and where it shows, Seri's hand-off as links.

**Why:** Its Status line says "Being built" (every ticket is done); its Stage 2 row says Seri is not deployed; it says calling tickets deploy with `AUTO_CALLS` off (on since 2026-10-30); about 25 decisions are scattered inline (audit, 2026-11-27).

**Depends on:** D34 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History, with a Status line in the fixed words;
- the three stale lines fixed; the eight "Decided with the client" rows and the inline decisions in one Decisions table;
- repeated facts linked: columns and settings to `SCHEMA.md`, activity actions to `AUDIT.md`, log events to `LOGGING.md`, the queue order to `QUEUE.md`, Seri's parts to `AI-AGENT.md`, rule 2d to `STATE-MACHINE.md`, variables to `ENVIRONMENT.md`;
- 113 code comments quote `AUTO-CALLS.md "<section>"`: keep each section's name where it can stay, and update the comments where it cannot - the list in *As built*.

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

`docs/README.md`'s table if a doc is added, renamed or its type changes; the tracker's row.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
