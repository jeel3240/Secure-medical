# Phase <N> tickets: <phase name>

<!-- Template: docs/DOCS.md, "Phase tickets". This file is
docs/<area>-tickets/README.md. -->

The build of `docs/<AREA>.md`, split into small tickets. Each ticket is one branch
off `dev`, merged into `dev` with `--no-ff`, with its code, its tests and every
related doc in the same commit. Read the design first, then the ticket.

**How to work a ticket:** read the ticket and every file it names; build only what
is under *Build*; tick every *Done when*; leave *Not in this ticket* alone. What was
built differently goes under *As built* - in the ticket and in the design doc - in
the same commit. The ticket's row below is updated in its own merge.

## The rules every ticket keeps

<Production keeps working; the database order; the gates; the quality bar - as in
docs/bucket-tickets/README.md.>

## The tickets

S is a few hours; M about a day. The *Depends on* column decides what can start.

| # | Ticket | Depends on | Size | Status |
|---|---|---|---|---|
| | **<Group>** | | | |
| <L>01 | [<Title>](<L>01-<slug>.md) | - | S | To do |

## The order

1. <A suggested path through the dependencies.>

## Waiting on

| What | Blocks |
|---|---|
| | |

## The decisions these tickets build on

<One paragraph, pointing to the design doc's Decisions table.>
