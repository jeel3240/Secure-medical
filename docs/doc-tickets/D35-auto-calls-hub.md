# D35 · AUTO-CALLS.md, the hub

**Goal:** `AUTO-CALLS.md` is an area doc of about 450 lines: who is called and when, traffic, Twilio refusing, how a call is placed, the webhooks, what is saved and where it shows, Seri's hand-off as links.

**Why:** Its Status line says "Being built" (every ticket is done); its Stage 2 row says Seri is not deployed; it says calling tickets deploy with `AUTO_CALLS` off (on since 2026-10-30); about 25 decisions are scattered inline (audit, 2026-11-27).

**Depends on:** D34 · **Size:** M · **Status:** Done 2026-11-27 - `AUTO-CALLS.md` in the area template, about 520 lines; `docs-check --type area` passes but for `DEPLOY.md`, still being written · **Deploy note:** none - documentation only.

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

- Status `Done 2026-11-02`; the Stage 2 row (Seri "not deployed") and "deployed with `AUTO_CALLS` off" moved to History as what used to be; ten decisions in one table, the script's and the transfer's in their own docs.
- Linked, not repeated: columns `SCHEMA.md`, actions `AUDIT.md`, log lines `LOGGING.md`, the queue `QUEUE.md`, Seri `AI-AGENT.md`, rule 2d `STATE-MACHINE.md`, variables `ENVIRONMENT.md`, switching `DEPLOY.md`, the timeline `TIMELINE.md`, the call back `INCOMING-CALLS.md`. The webhook table lost its empty "Later" column; each row now links the doc with the detail.
- Section names kept as `###`: "The whole flow", "When a lead is called", "Leads already waiting", "Traffic", "When Twilio refuses", "How a call is placed", "Where it shows". A table, "The sections that moved", maps every moved name, so the code comments that quote them still lead somewhere; the comments themselves are not edited here (code is not this rewriter's) - each is listed in `renames.from-robot.md`.
- Over the 450-line aim: the webhook table and the Tests table carry it; under the 600 limit.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
