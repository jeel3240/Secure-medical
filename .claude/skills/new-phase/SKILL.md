---
name: new-phase
description: Start or plan a new phase of Secure Medical work the standard way - the design doc, the decisions, the tracker and the ticket files from docs/templates, exactly as docs/DOCS.md says. Use when Jeel asks to plan a new phase or feature, write its tickets, or "create tickets".
---

# Planning a new phase

Follow `docs/DOCS.md`, "Planning a phase", exactly. Read it first, every time. The
structure is fixed so every phase looks the same; do not invent files or sections.

## Before anything

1. Read `docs/DOCS.md`, then the templates in `docs/templates/`, then one finished
   phase as the model: `docs/bucket-tickets/README.md` and two of its tickets.
2. Pick the phase's letter: the next free one in `docs/DOCS.md`, "The phases".
3. Read the code the phase touches before writing a ticket (CLAUDE.md, "The order of work"): use
   read-only survey agents for a large area, and an adversarial review of the
   draft breakdown against the code before it is final.

## The steps

1. **Discuss** in chat until the shape is clear.
2. **Design**: the phase's area doc in `docs/` - a new `docs/<AREA>.md` from
   `docs/templates/AREA.md`, or the existing area doc it changes - with a Status
   line under the title.
3. **Decide**: put each open decision to Jeel **one at a time**, in plain chat -
   never the question popup - as a short concrete example, your pick, and a yes/no
   question. Write each answer into the doc's Decisions table (decision · by ·
   date).
4. **Tickets**, only after Jeel approves the breakdown:
   - `docs/<area>-tickets/README.md` from `docs/templates/TRACKER.md`;
   - one `docs/<area>-tickets/<L><NN>-<slug>.md` per ticket from
     `docs/templates/TICKET.md` - every section, every file and function named,
     every *Done when* naming the test that proves it, every doc to update;
   - sizes S or M only; split anything bigger;
   - check before committing: every named file and function exists (or the ticket
     says it is new), the tracker table matches the ticket files, links resolve.
5. **Register**: a row in `docs/DOCS.md`, "The phases", and in `docs/README.md`'s
   table. CLAUDE.md carries no phase rows.
6. One branch off `dev` (`docs/<area>-tickets`), merged into `dev` with `--no-ff`,
   only when Jeel says so.

## Never

- No other planning files in the repo: no `pending.md`, `plan.md`, `notes.md`,
  `TODO.md`. Plan-mode files outside the repo are scratch.
- No time estimates in documents meant for the team.
- No names but Jeel's in any committed file.
- No building: this skill plans. Building starts when Jeel says, one ticket per
  branch.
