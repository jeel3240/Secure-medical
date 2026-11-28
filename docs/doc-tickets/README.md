# Docs to the standard: the tickets

Every doc brought to `docs/DOCS.md`, split into small tickets - written 2026-11-27
from an audit of every doc against the standard (four reads, one per group of
docs). Each ticket is one branch off `dev`, merged into `dev` with `--no-ff`, in one
commit. Nothing has been rewritten yet.

**How to work a ticket:** read `docs/DOCS.md`, the ticket, the doc it rewrites and
the code that doc describes; build only what is under *Build*; tick every *Done
when*. A fact the ticket was unsure of is checked against the code - **the code
wins** - and what was found goes under *As built*.

## The rules every ticket keeps

- **Nothing is lost.** Text that stops being true moves to History; a fact that
  moves to another doc is in that doc before it leaves this one. Each ticket's PR
  lists what moved where.
- **One fact, one place.** A ticket that finds a fact in two docs leaves it in the
  owner (`docs/README.md`'s table says which) and links from the other.
- **The code wins.** Every file, function, setting and route a rewritten doc names
  is checked to exist; a claim that is wrong is fixed, not copied.
- **Code comments follow.** About 200 code comments quote doc sections by name; a
  ticket that moves or renames a section updates them.
- **No behaviour changes.** These are documentation tickets. The only code they
  touch is comments, test fixtures (D01) and the docs check (D47).
- **The gates:** the docs check (`npm run docs:check`, once D47 is in); for D01,
  the backend and frontend tests and the live checks.

## The tickets

S is a few hours; M about a day. The *Depends on* column decides what can start.

| # | Ticket | Depends on | Size | Status |
|---|---|---|---|---|
| | **Urgent** | | | |
| D01 | [Real data out of the docs](D01-real-data-out.md) | - | S | To do |
| | **The map - CLAUDE.md, the index, running, testing, deploying** | | | |
| D02 | [ARCHITECTURE.md](D02-architecture.md) | D01 | M | To do |
| D03 | [The original plan, out of CLAUDE.md](D03-original-plan.md) | D01 | M | To do |
| D04 | [CLAUDE.md §3-§8 to their owners](D04-claude-md-sections-to-owners.md) | D02 | M | To do |
| D05 | [CLAUDE.md, short](D05-claude-md-short.md) | D02, D03, D04, D06 | S | To do |
| D06 | [docs/README.md becomes the index](D06-docs-readme-split.md) | D01 | M | To do |
| D07 | [The root README](D07-root-readme.md) | D02, D06 | S | To do |
| D08 | [WORKFLOW.md and DEPLOY.md](D08-workflow-and-deploy.md) | D01 | M | To do |
| | **Reference docs** | | | |
| D09 | [SCHEMA.md](D09-schema.md) | D01, D04 | M | To do |
| D10 | [AUDIT.md](D10-audit.md) | D01 | M | To do |
| D11 | [LOGGING.md](D11-logging.md) | D01 | M | To do |
| D12 | [EZTEXTING-API.md](D12-eztexting-api.md) | D01 | S | To do |
| | **Area docs** | | | |
| D13 | [AUTH.md](D13-auth.md) | D01 | S | To do |
| D14 | [FLOWS.md](D14-flows.md) | D01 | S | To do |
| D15 | [WEBHOOKS.md](D15-webhooks.md) | D01 | S | To do |
| D16 | [POLLER.md](D16-poller.md) | D01, D08 | M | To do |
| D17 | [QUEUE.md](D17-queue.md) | D01 | M | To do |
| D18 | [ADMIN-LEADS.md](D18-admin-leads.md) | D01 | M | To do |
| D19 | [ADMIN.md](D19-admin.md) | D01, D03 | M | To do |
| D20 | [AGENT-WORKSPACE.md](D20-agent-workspace.md) | D01 | M | To do |
| D21 | [CALLBACKS.md](D21-callbacks.md) | D20 | S | To do |
| D22 | [TIMELINE.md](D22-timeline.md) | D20 | S | To do |
| D23 | [STATE-MACHINE.md](D23-state-machine.md) | D01 | M | To do |
| D24 | [The antibiotics flow out of STATE-MACHINE.md](D24-antibiotics-flow-out.md) | D23, D14 | S | To do |
| D25 | [LEAD-FLOW.md](D25-lead-flow.md) | D02, D17, D18, D20 | S | To do |
| | **The frontend and the brief** | | | |
| D26 | [FRONTEND.md: the workspace and calling sections to their owners](D26-frontend-sections-to-owners.md) | D20, D21, D22 | M | To do |
| D27 | [FRONTEND.md: the queue and admin sections to their owners](D27-frontend-queue-admin-to-owners.md) | D17, D18, D19 | S | To do |
| D28 | [FRONTEND-STYLE.md](D28-frontend-style.md) | D01 | S | To do |
| D29 | [FRONTEND.md, what remains](D29-frontend.md) | D26, D27, D28 | M | To do |
| D30 | [DESIGN-PROMPT.md's notes to their owners](D30-design-prompt-notes-to-owners.md) | D29 | S | To do |
| D31 | [DESIGN-PROMPT.md restored](D31-design-prompt-restored.md) | D30 | S | To do |
| | **Robot calls and Twilio** | | | |
| D32 | [Phase 6's tracker out of AUTO-CALLS.md](D32-auto-call-tickets-tracker.md) | D01 | S | To do |
| D33 | [Tickets T0-T14 into files](D33-auto-call-tickets-t00-t14.md) | D32 | M | To do |
| D34 | [Tickets T15a-T29 into files](D34-auto-call-tickets-t15-t29.md) | D33 | M | To do |
| D35 | [AUTO-CALLS.md, the hub](D35-auto-calls-hub.md) | D34 | M | To do |
| D36 | [AUTO-CALL-SCRIPT.md](D36-auto-call-script.md) | D35 | M | To do |
| D37 | [AUTO-CALL-TRANSFER.md](D37-auto-call-transfer.md) | D35 | M | To do |
| D38 | [TWILIO.md and INCOMING-CALLS.md](D38-twilio-and-incoming.md) | D01 | M | To do |
| D39 | [TWILIO-SETUP.md](D39-twilio-setup.md) | D38, D06, D08 | S | To do |
| | **Seri** | | | |
| D40 | [AI-BRAIN.md](D40-ai-brain.md) | D01 | M | To do |
| D41 | [AI-RELAY.md and AI-KNOWLEDGE.md](D41-ai-relay-and-knowledge.md) | D40 | S | To do |
| D42 | [Seri's call-by-call notes to the tickets](D42-ai-call-narratives.md) | D40 | M | To do |
| D43 | [AI-AGENT.md, what remains](D43-ai-agent.md) | D40, D41, D42 | M | To do |
| D44 | [Phase 7's tracker aligned](D44-ai-agent-tickets-aligned.md) | D01 | S | To do |
| | **Phase 8 and the review** | | | |
| D45 | [BUCKETS.md](D45-buckets.md) | D01 | S | To do |
| D46 | [REVIEW-2026-11-22.md](D46-review.md) | D01 | S | To do |
| | **Keeping it so** | | | |
| D47 | [A docs check](D47-docs-check.md) | D01 | M | To do |
| D48 | [The last sweep](D48-final-sweep.md) | every other D-ticket | S | To do |

## The order

1. D01 first - real data out.
2. D47, the docs check, early - every ticket after it is checked by it.
3. The map (D02-D08) - CLAUDE.md is read every session, so it matters most.
4. Any area or reference doc, in any order; the frontend after the docs it feeds;
   the robot-call split in its own order (D32-D37).
5. D48 last.

## Waiting on

| What | Blocks |
|---|---|
| Jeel: whether to remove the real data from git history too (a rewrite and a force push) | Only D01's last box |

## What the audit found, in short

- **No doc has a History or a Decisions table**; dates sit inside sentences - 82 in
  CLAUDE.md, 129 in AI-AGENT.md, 97 in AUTO-CALLS.md.
- **Real data**: a real contact from the client's account, a real handset number,
  a tester's handle about 80 times, production's domain (D01).
- **Stale facts** in most docs - a constant that does not exist, a POST route said
  not to exist, Seri said not deployed, counts that drifted - each listed in its
  ticket.
- **Too big**: CLAUDE.md (870 lines), AUTO-CALLS.md (3,203, its 35 tickets inline),
  FRONTEND.md (937), TWILIO.md (920), AI-AGENT.md (887), STATE-MACHINE.md (884),
  AGENT-WORKSPACE.md (731) - each split by topic.
- **New docs**: ARCHITECTURE, ORIGINAL-PLAN, RUNNING, TESTING, ENVIRONMENT, DEPLOY,
  CALLBACKS, TIMELINE, FRONTEND-STYLE, AUTO-CALL-SCRIPT, AUTO-CALL-TRANSFER,
  INCOMING-CALLS, TWILIO-SETUP, AI-BRAIN, AI-RELAY, AI-KNOWLEDGE, and
  `auto-call-tickets/`.
