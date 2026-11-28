# How the docs are written

Every doc in this repo follows this standard, so that anyone - a person or Claude -
finds a fact in one known place and can trust that it is true today. Read it before
writing or changing any doc. Written 2026-11-27 at Jeel's request: one clear
structure for the docs and for planning a phase, the same every time.

## The rules

1. **Today first, history last.** The body says how things work **now**, in the
   present tense. No dated notes inside sentences (*"(2026-09-28: ...)"*), no "until
   then", no "As built" asides. Every change gets one line in the doc's **History**
   section, at the bottom, newest first:
   `- 2026-11-27 · what changed · why · ticket or PR`.
   Text that stops being true is **moved** to History, never deleted - nothing is
   lost (`AUDIT.md`'s rule, applied to the docs).
2. **One fact, one place.** Each fact lives in the doc that owns it - `README.md`'s
   table says which doc owns what. Other docs link to it (`QUEUE.md`, "The order")
   and never restate it.
3. **The code wins.** A doc that disagrees with the code is wrong until checked;
   whichever is wrong is fixed. Check the code before trusting a doc (CLAUDE.md, "The order of work").
4. **Same commit.** A change to what the app does updates the doc that owns it in
   the same commit - not afterwards.
5. **Decisions say who and when.** Each doc that owns decisions keeps them in its
   **Decisions** table: decision · by · date. Only Jeel's name is written; no
   colleague, client staff or partner names in any committed file.
6. **Plain and short.** Short sentences; a table for items compared on several
   points; a numbered list for steps; code names, files and settings in backticks;
   paths relative to the repo root; dates `YYYY-MM-DD`; times with their zone.
7. **Sized to be read.** A doc that passes about 600 lines is split by topic, never
   by date.
8. **No secrets, no real people.** No credentials, no real leads' numbers or names.
   The test numbers already in the docs are the only phone numbers.

## The types of doc

Every doc is one of these types. Its sections are the type's, in this order, with
these exact headings; a section with nothing to say is left out, not left empty.

| Type | Docs | What it is for |
|---|---|---|
| **Map** | `CLAUDE.md` (root), `README.md` (root), `docs/README.md` | Where everything is, and the rules for working in the repo |
| **Architecture** | `docs/ARCHITECTURE.md` | The parts of the system, how they connect, and why it is built this way |
| **Area** | one per part of the app - `QUEUE.md`, `POLLER.md`, `TWILIO.md`, `AI-AGENT.md`... | What one part does and the rules it keeps |
| **Reference** | `SCHEMA.md`, `EZTEXTING-API.md`, `LOGGING.md`, `AUDIT.md` | Tables to look things up in |
| **How-to** | `WORKFLOW.md`, and running and testing | Steps to follow |
| **Phase tickets** | `docs/<area>-tickets/` | The build of one phase: a tracker and one file per ticket |
| **Review** | `REVIEW-YYYY-MM-DD.md` | One review's findings and what became of each |
| **Brief** | `DESIGN-PROMPT.md`, the mockup PDF | The original brief - kept as it was, not updated |

### Map

- **`CLAUDE.md`** is read at the start of every Claude session, so it stays short:
  what the app is, the rules for working here (branches, migrations, credentials,
  what never to run), and pointers. No architecture, no data model, no phase
  history - those have their own docs.
- **Root `README.md`**: one screen, pointing into `docs/`.
- **`docs/README.md`**: the index - every doc, its type, what it owns, and when to
  update it. Nothing else.

### Architecture

One doc, `ARCHITECTURE.md`. Sections: lead paragraph · **The parts** (each service
and what runs where) · **How they connect** (a diagram, then the flow of a lead
through them) · **Outside services** (EZ Texting, Twilio, OpenAI...) · **Decisions**
(why this shape and not another - Lambda, Supabase, Cognito, Nginx...) · **History**.

### Area doc

Template: `docs/templates/AREA.md`. Sections:

1. a lead paragraph - what this part is, in two or three sentences, and where its
   code lives;
2. **How it works** - today, step by step;
3. **Rules** - what must always hold; numbered when other docs point at them;
4. **Data** - what it reads and writes, linking `SCHEMA.md`, never repeating it;
5. **Code** - the files and main functions;
6. **Tests** - what proves it: unit tests, live checks, the e2e;
7. **Not done** - known limits and what is deliberately left out;
8. **Decisions** - decision · by · date;
9. **History** - dated lines, newest first.

A phase's design doc is an area doc (`AI-AGENT.md`, `BUCKETS.md`): while the phase
is being built it carries a **Status** line under its title and its parts; when the
phase is done, what only mattered while building moves to History.

### Reference

Template: `docs/templates/REFERENCE.md`. Sections: a lead paragraph · the table or
tables · **How to add an entry** · **History**.

### How-to

Template: `docs/templates/HOWTO.md`. Sections: a lead paragraph · **Before you
start** · the steps, numbered · **When it goes wrong** · **History**.

### Phase tickets

A phase is built from small tickets, in its own folder next to its design doc:

- `docs/<area>-tickets/README.md` - the tracker (template `docs/templates/TRACKER.md`);
- `docs/<area>-tickets/<L><NN>-<slug>.md` - one per ticket (template
  `docs/templates/TICKET.md`): the phase's letter, a two-digit number, a short slug
  in lower case with hyphens.

Nothing else: no `pending.md`, no `plan.md`, no notes files. Claude's plan-mode
file lives outside the repo and is scratch - what matters from it lands in these
files.

### Review

`REVIEW-YYYY-MM-DD.md`: a lead paragraph (what was reviewed, how), then a findings
table - id · what · where · status (fixed, decided, open) - and nothing else.

### Brief

`DESIGN-PROMPT.md` and the mockup are the original brief. They are kept as they
were, with one note at the top pointing to the docs that say what was built; they
are not updated as the app changes.

## Planning a phase

The same steps every phase:

1. **Discuss** - the problem and the options, in chat.
2. **Design** - the phase's area doc (a new one, or the area it changes), with a
   Status line.
3. **Decide** - each open decision put to Jeel one at a time, and written into the
   doc's Decisions table.
4. **Tickets** - the tracker and the ticket files, from the templates, read against
   the code before they are written.
5. **Register** - a row in "The phases" below and in `docs/README.md`'s table.
   CLAUDE.md carries no phase rows: it points here.
6. **Build** - one ticket per branch, merged into `dev`; its tracker row updated in
   the same merge; anything built differently written under the ticket's *As built*
   and in the design doc.
7. **Close** - the Status line says done; what only mattered while building moves to
   History.

The `/new-phase` command (`.claude/skills/new-phase/`) walks through these steps.

### The fixed words

- **Status:** `To do` · `In progress` · `Waits on <what>` · `Paused YYYY-MM-DD - <why>` ·
  `Done YYYY-MM-DD - <evidence>` · `Dropped YYYY-MM-DD - <why>`.
- **Size:** `S` - a few hours; `M` - about a day. Nothing bigger: split it.
- **Ticket heading:** `# <ID> · <Title>`.
- **Phase 6's exception:** its tickets keep the ids the code cites - `T0` to
  `T29`, with `T13b` and `T15a`-`T15c`. Their files take two digits so the folder
  sorts (`T00-resend-first-texts.md`); the heading keeps the cited id
  (`# T0 · ...`). They were never sized: Size is `-`.

### The phases

| Phase | Letter | What it is | Design | Tickets |
|---|---|---|---|---|
| 1 · Foundation | - | Leads pulled in from EZ Texting, texts sent and received, sign-in. Done | `ORIGINAL-PLAN.md`, Week 1 | before this standard |
| 2 · The SMS flow | - | The questions asked by text, the answers scored and tiered, the queue's API. Done, approved 2026-09-23 | `ORIGINAL-PLAN.md`, Week 2; `STATE-MACHINE.md` | before this standard |
| 3 · Everything but calling | - | The screens - the queue, the agent's workspace, the timeline, My Callbacks, the admin screens, read-only - and logging, retries, the end-to-end script. Done 2026-09-28 | `ORIGINAL-PLAN.md`, "Phase 3 task list" | before this standard |
| 4 · Calling | - | Agents call leads from the browser through Twilio; a lead calling in rings an agent, and a missed call is texted and called back. Done 2026-10-01, on production 2026-10-05 | `TWILIO.md`, `INCOMING-CALLS.md` | before this standard |
| 5 · Flows | - | The SMS questions stored as rows, so a new set is rows, not code; the client's antibiotics flow; a recording notice on calls. On production 2026-10-06 | `FLOWS.md` | before this standard |
| 6 · Automated calls | T | The server calls leads who never replied and puts a "yes" through to a person who is free | `AUTO-CALLS.md`, with `AUTO-CALL-SCRIPT.md` and `AUTO-CALL-TRANSFER.md` | `auto-call-tickets/` (moved out of `AUTO-CALLS.md`, 2026-11-27) |
| 7 · AI agent | A | Seri runs the automated call: she answers questions and ends each call one of five ways, with the script as her backup | `AI-AGENT.md` | `ai-agent-tickets/` |
| 8 · Several buckets | B | Several campaigns at once, each with its own group, questions, robot script and what Seri knows | `BUCKETS.md` | `bucket-tickets/` |
| Docs to this standard | D | Every doc brought to this standard | this doc | `doc-tickets/` |

Each phase's state is its design doc's Status line; Phases 1 to 5 came before
Status lines, so their state is here. A new phase takes the next free letter.

## Checking a doc

`npm run docs:check` (from `backend/`; `scripts/docs-check.mjs`) checks the
links, file paths, phone numbers, forbidden names, sections and dated asides of
every doc - `--self-test` shows each rule catching its fault. Before a doc change
is merged, it passes, and:

- [ ] its type, and its sections in the type's order;
- [ ] the body says how things work today - no dated notes left in it;
- [ ] every change since is a line in History;
- [ ] no fact repeated that another doc owns - linked instead;
- [ ] every file, function and setting it names exists (`grep`);
- [ ] every link resolves;
- [ ] no names but Jeel's; no secrets.

## History

- 2026-11-27 · Every doc brought to this standard - `doc-tickets/` D01-D48, all done the same day; the docs check gained its `refs` rule (a section a doc or a code comment points at must exist) · D48
- 2026-11-27 · "The phases" gives each phase a one-line summary, Phases 1 to 5 a row each, from `CLAUDE.md` §10's phases table, which moved to `ORIGINAL-PLAN.md` · D03
- 2026-11-27 · Written · Jeel: every phase's planning and tickets came out a little
  different, and the docs mixed history into the text · branch `docs/standard`; the docs brought to it by `doc-tickets/`
