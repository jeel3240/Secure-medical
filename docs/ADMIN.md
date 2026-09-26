# Admin screens

The superadmin area: Overview, Configuration, DNC list. Phase 3.

Admin > Leads has its own doc, `ADMIN-LEADS.md`, and Agents is covered by
`AUTH.md`. Screens: `DESIGN-PROMPT.md` section 6.

**Admin is read-only except Agents - decided by Jeel, 2026-09-23.** Scoring
rules, tier bands, message copy, expiry and the DNC list are shown, not edited.
The reasoning and the full before/after are in CLAUDE.md §10, "Phases, and what
Phase 3 is". Changes go through a numbered migration and a PR.

**Built 2026-09-26** (Phase 3 tasks 10, 11 and 12): all three endpoints -
`api/admin/config.ts`, `api/admin/overview.ts`, `api/admin/dnc.ts`, over
`db/admin-config.ts`, `db/admin-overview.ts`, `db/admin-dnc.ts`. The screens
themselves are tasks 23, 24 and 25. Every route is superadmin only and has no
POST, PUT, PATCH or DELETE - tests assert that, so read-only stays a decision
rather than something that erodes.

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

**As built.** Each message carries `length`, `worstCaseLength`, `segments` and
`costsExtraSegment`. The worst case matters more than the stored length: an
opener holding `{first_name}` is a different length for every lead, so the
count is taken against the longest first name currently in the `leads` table -
returned as `longestFirstName` - or the `there` fallback when that is shorter.
A message that fits in one segment for "Jo" and not for "Christopher" is one
that costs two segments for some leads, and the page has to show that.

`message_stop` is not returned. EZ Texting sends the unsubscribe confirmation
and we never do - `STATE-MACHINE.md` rule 1 - so listing it among our copy
would misrepresent what goes out. It stays seeded in `settings` in case the
account's own handling is ever switched off.

`maxScore` is computed from the rows, not fixed at 100, so an edited rule shows
up on the page instead of quietly disagreeing with the tier bands beneath it.

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

**As built.** `period` defaults to `today`, which means since midnight rather
than the last 24 hours. Leads are counted by when they reached us
(`ezt_added_at`, falling back to `created_at`) - the same expression the queue
uses for a lead's age - while calls, notes, callbacks and dispositions are
counted by when they happened, so a call made today about last week's lead
lands in today's figures.

**Every call figure is zero until Phase 4,** because nothing writes `calls`
yet. They are counted the way they will be once Twilio lands, so the screen
does not change shape later, and `callsBuilt: false` comes back with them - a
superadmin should not have to wonder whether nobody is calling or nothing is
recording it. `reachedPct` is 0 rather than NaN while the base is 0.

The activity feed is a four-way UNION over `dispositions`, `notes`, `callbacks`
and agent-sent `messages`, newest first, capped at 50. Agent actions only: the
automated flow is already visible per lead on the timeline, and this feed
answers "what are my agents doing".

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

**As built.** `state` is `all` by default, and `all`, `blocked` or `released`
are the accepted values. Counts for all three come back whichever is asked for,
so a tab badge is right while another tab is open. Search takes digits only
when the query contains any, so `(555) 999-9999` finds `+15559999999`; a query
with no digits matches the lead's name instead. `%` and `_` are escaped, or a
search box holding one would match every row.

The lead join is `LEFT`: a number can be blocked before we ever hold a lead for
it - the poller's check on a later partner delivery depends on exactly that -
and those rows are listed with `lead: null`.

Export CSV is in the design brief. Worth having, and cheap, but it hands a file
of phone numbers to a browser - a superadmin-only route, and not something to
add without Jeel saying so. Not built.

`scripts/admin-live-check.ts` proves all three read models against a real
database: the config against the rows seeded by `001_init.sql` and against an
edited rule, the overview's period windows, funnel and per-agent aggregates,
and the DNC list's states, search escaping and lead-less rows.
