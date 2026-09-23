# Admin screens

The superadmin area: Overview, Configuration, DNC list. Phase 3.

Admin > Leads has its own doc, `ADMIN-LEADS.md`, and Agents is covered by
`AUTH.md`. Screens: `DESIGN-PROMPT.md` section 6.

**Admin is read-only except Agents - decided by Jeel, 2026-09-23.** Scoring
rules, tier bands, message copy, expiry and the DNC list are shown, not edited.
The reasoning and the full before/after are in CLAUDE.md §10, "Phases, and what
Phase 3 is". Changes go through a numbered migration and a PR.

**None of it is built.** Paths below are proposed; the read-only decision is not.

## Configuration (new page, replaces 6b and 6c)

One page, because neither half has actions any more and they are read together:
here is what we ask, here is what each answer is worth.

- The three questions, the three clarifications and the thanks message, exactly
  as they sit in `settings`, each with its character and segment count so it is
  obvious when a message costs two segments.
- The scoring table: response, completion, and the three points per answer for
  each question, with the maximum possible.
- The tier bands.
- Conversation expiry, fixed at 7 days.

`GET /api/admin/config` returns all of it from `settings`, `scoring_rules` and
`tiers`, so the page always shows what the state machine is actually using
rather than a copy in the frontend. That is the point of the page: not
documentation of what we intended, but a window on live values.

**No Save, no Recalculate.** A rule change therefore leaves existing leads on
their old scores. Accepted - CLAUDE.md §10.

## Overview (6a)

`GET /api/admin/overview?period=today|7d|30d`

KPI cards, a funnel, a per-agent table and a recent activity feed, all derived
from the existing tables. Nothing here is stored as a running total; at 50-100
leads a day the queries are cheap and a stale counter is worse than a slow one.

**Live system status** - last poll, last inbound webhook, worker health - comes
from the health endpoint in `LOGGING.md` rather than this route, so that
anything monitoring the system from outside reads exactly what the screen does.

The per-agent table and the activity feed are the only place one agent's work is
visible to anyone but themselves. Agents cannot reach this page: `AUTH.md`.

## DNC list (6e)

`GET /api/admin/dnc?q=&page=` - phone, reason, who added it, when, and whether
it was released.

Read-only, and there is no manual add (Jeel, 2026-09-23): a number reaches the
list through an agent's DNC disposition, an SMS STOP, or an EZ Texting opt-out
found by the poller. `AGENT-WORKSPACE.md` has the disposition path,
`STATE-MACHINE.md` the SMS ones.

No delete, by design - the design brief calls it a compliance record. A number
can still be released by the lead texting START, which keeps the row and stamps
`released_at`: `STATE-MACHINE.md`, "Opting back in". The screen has to show
released rows as released rather than hiding them, or the list stops matching
who is actually blocked.

Export CSV is in the design brief. Worth having, and cheap, but it hands a file
of phone numbers to a browser - a superadmin-only route, and not something to
add without Jeel saying so.
