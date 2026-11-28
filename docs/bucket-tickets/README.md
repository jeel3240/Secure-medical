# Phase 8 tickets: several buckets

The build of `docs/BUCKETS.md`, Part 1, split into small tickets; each one's state
is its row in "The tickets". Each ticket is one branch off `dev`, merged into
`dev` with `--no-ff`, with its code, its tests and every related doc in the same
commit. Read `BUCKETS.md` first, then the ticket.

**How to work a ticket:** read the ticket and every file it names; build only what
is under *Build*; tick every *Done when*; leave *Not in this ticket* alone. What was
built differently from the ticket goes under *As built* - in the ticket and in
`BUCKETS.md` - in the same commit. The ticket's row below is updated in its own
merge.

Part 2 (uploaded lists) is on hold and Part 3 (setup screens) comes later: neither
has tickets. B01 to B05 are not bucket work: they were decided while planning it and
are built on their own.

## The rules every ticket keeps

**Production keeps working.** Jeel deploys `dev` to production in batches, so every
ticket, merged alone, leaves production working with the one antibiotics bucket
exactly as today. Database changes go expand, switch, contract: a migration adds the
new thing; the code moves to it; a later migration, in a later deploy, drops the old
thing. An old "only one" index is dropped only by the ticket that stops relying on
it.

**The gates.** Before a ticket is merged:

- backend: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:scripts`;
- frontend, when touched: `npm test`, `npm run lint`, `npm run build`;
- `scripts/live-checks.sh` when any SQL changes;
- the upgrade check (B03) for a migration that fills in existing rows;
- `npm run speed` when the queue's, Admin > Leads' or the lead page's SQL changes;
- `npm run e2e` when a flow, a call or the poller changes;
- `docker compose build api worker`.

A ticket's *Done when* names the tests that prove it; every new test is seen to fail
on the code before the change.

**The quality bar.**

- A rule is a pure function in `core/` with unit tests; the SQL that feeds it is
  proved against a real Postgres by a live check. No rule lives only in SQL.
- The database enforces what it can: a foreign key for every link, a unique index for
  every "only one", a check for every fixed set of values (`BUCKETS.md`, "The
  database").
- Each fact is stored in one place: what moves is copied, then removed.
- Nothing may be lost (`AUDIT.md`): every action a person or the app takes writes its
  `activity_log` row in the same transaction; a value that is overwritten keeps what
  it was in that row.
- Every new log event is listed in `LOGGING.md`. Log fields name a bucket by
  `bucketId` - `lib/log.ts` redacts `name` and any field ending in `key`.
- No `any`, no new lint exception, no copy of shared SQL - extend the shared piece.
- A migration has the header the others have (what, ticket, date, why, what it does
  not change), named constraints, and a "stops unless" guard wherever it changes rows
  it expects in a known state (018's pattern).

**Deploy notes.** The runbook runs the migrations before the new code
starts (`DEPLOY.md`, "Deploying"), so a ticket's code may read a column its own
migration adds. Its migration must then suit the old code still running - it adds;
a drop waits for a later deploy. A ticket's *Deploy note* says when it needs more.

## The tickets

S is a few hours; M about a day. The numbers group the tickets by area, not by
build order: a ticket may depend on a higher-numbered one (B24 on B28, B33 and
B34, for instance). The *Depends on* column decides what can start; "The order",
below, is a suggested path through it.

| # | Ticket | Depends on | Size | Status |
|---|---|---|---|---|
| | **A. Ready now - no buckets needed** | | | |
| B01 | [Queue: tier first, then newest](B01-queue-tier-then-newest.md) | - | S | Done 2026-11-28 - the queue live check's order section, the e2e and the speed check |
| B02 | [Deploy order: migrations before the new code](B02-deploy-order-migrations-first.md) | - | S | Done 2026-11-28 - the new order run locally, and the production image migrating a scratch database |
| B03 | [The upgrade check](B03-upgrade-check.md) | - | S | Done 2026-11-28 - `harness-upgrade-check` in the full live-check run |
| B04 | [Closed asks why](B04-closed-asks-why.md) | B03 | M | Done 2026-11-28 - migration 025; the live, upgrade, route, frontend and e2e checks; the popup seen in Chrome |
| B05 | [Overview counts sold](B05-overview-counts-sold.md) | B04 | S | Done 2026-11-28 - the admin live check's sold section, the frontend tests and the speed check; the card seen in Chrome |
| B06 | [Poller: one contact never stops the rest](B06-poller-one-contact-never-stops-the-rest.md) | - | S | Done 2026-11-28 - the poller's tests, the health and Admin > Leads live checks, the e2e |
| | **B. Buckets in the database - one bucket, nothing changes for users** | | | |
| B07 | [Migration: buckets](B07-migration-buckets.md) | B03 | S | To do |
| B08 | [The flow per bucket](B08-flow-per-bucket.md) | B07 | S | To do |
| B09 | [Migration: bucket arrivals](B09-migration-bucket-arrivals.md) | B07 | M | To do |
| B10 | [One seed helper for tests and scripts](B10-seed-helper.md) | B09 | M | To do |
| B11 | ["Received" and "Source" from arrivals](B11-received-and-source-from-arrivals.md) | B10 | M | To do |
| B12 | [Timeline: arrivals and every conversation](B12-timeline-arrivals-and-conversations.md) | B09 | S | To do |
| B13 | [Migration: remove what moved](B13-migration-remove-what-moved.md) | B11, B12, B14, B23 | S | To do - a later deploy than B11 |
| | **C. Rules per conversation - one bucket still** | | | |
| B14 | [First-question retry and resend per conversation](B14-opener-retry-per-conversation.md) | B11 | S | To do |
| B15 | [Calls know their conversation](B15-calls-know-their-conversation.md) | B03, B07 | S | To do |
| B16 | [Readers per conversation](B16-readers-per-conversation.md) | B15 | S | To do |
| B17 | [The dialler per conversation](B17-dialler-per-conversation.md) | B15 | M | To do |
| B18 | [The script per call](B18-script-per-call.md) | B08, B15 | M | To do |
| B19 | [Closed and "worked" per conversation](B19-closed-and-worked-per-conversation.md) | B04 | S | To do |
| | **D. Several buckets in intake - waits on the client's OK for two groups** | | | |
| B20 | [EZ Texting: groups and moving a contact](B20-ezt-client-groups-and-moves.md) | - | S | Waits on the client |
| B21 | [Bucket groups](B21-bucket-groups.md) | B07, B20 | M | Waits on the client |
| B22 | [Who an arrival is](B22-decide-arrival.md) | B04, B19 | S | To do |
| B23 | [Taking a person in](B23-taking-a-person-in.md) | B08, B09, B22 | M | To do |
| B24 | [The two-group read](B24-two-group-read.md) | B06, B14, B17, B20, B21, B23, B28, B33, B34 | M | Waits on the client - deploys with B25 |
| B25 | [The switch-over, and `EZT_GROUP` retired](B25-switch-over.md) | B24 | S | Waits on the client - deploys with B24 |
| B26 | [Texts switch per bucket](B26-texts-switch-per-bucket.md) | B24 | S | Waits on the client |
| | **E. Screens** | | | |
| B27 | [Queue: Bucket column and filter](B27-queue-bucket-column.md) | B07 | M | To do |
| B28 | [Queue: Needs review · 2 buckets](B28-queue-two-buckets-tag.md) | B09, B23 | S | To do |
| B29 | [Admin > Leads: Bucket column and filter](B29-admin-leads-bucket.md) | B07, B28 | S | To do |
| B30 | [Lead page: the person's buckets](B30-lead-page-bucket-badges.md) | B09, B12 | S | To do |
| B31 | [Admin > Configuration: a bucket picker](B31-config-bucket-picker.md) | B08, B18, B33, B35 | M | To do |
| B32 | [Admin > Configuration: switches per bucket](B32-config-bucket-switches.md) | B26, B34 | M | Waits on the client |
| | **F. Calls per bucket - Seri's for every new bucket** | | | |
| B33 | [Missed-call text and line per bucket](B33-missed-call-per-bucket.md) | B07 | S | To do |
| B34 | [Calls per bucket](B34-calls-per-bucket.md) | B17 | M | To do |
| B50 | [The call lines per bucket](B50-call-lines-per-bucket.md) | B07, B18 | M | To do |
| B51 | [Seri failing on a bucket with no script](B51-seri-fallback-with-no-script.md) | B15, B18, B35 | S | Waits on A22 (via B35) |
| | **G. Seri per bucket** | | | |
| B35 | [Seri's switch per bucket](B35-seri-switch-per-bucket.md) | B15, A22 | M | Waits on A22 |
| B36 | [Knowledge packs](B36-knowledge-packs.md) | B07 | M | To do |
| B37 | [The campaign in the pack](B37-campaign-in-the-pack.md) | B36 | S | To do |
| B38 | [Speak and understand read the pack](B38-speak-and-understand-read-the-pack.md) | B37 | M | To do |
| B39 | [Safety and policy read the pack](B39-safety-and-policy-read-the-pack.md) | B37 | S | To do |
| B40 | [Each call gets its bucket's pack](B40-each-call-gets-its-pack.md) | B15, B36-B39 | S | To do |
| B41 | [Seri's health per bucket](B41-seri-health-per-bucket.md) | B15, B35 | S | Waits on A22 |
| B42 | [The evals per pack](B42-evals-per-pack.md) | B37 | S | To do |
| | **H. Proving it and shipping** | | | |
| B43 | [A test bucket and the e2e across two buckets](B43-e2e-two-buckets.md) | B18, B28, B33, B34, B50, B51 (the gate), B40 | M | To do |
| B44 | [How to add a bucket](B44-how-to-add-a-bucket.md) | B43 | S | To do |
| B45 | [Every path on the test account](B45-real-test-two-buckets.md) | B43 | M | To do |
| B46 | [Deploy, the switch-over watched](B46-deploy.md) | B45 | S | To do |
| B47 | [Second bucket: texts](B47-second-bucket-texts.md) | B46, the client's content | S | Waits on the client |
| B48 | [Second bucket: robot script](B48-second-bucket-robot-script.md) | B47 | S | Dropped 2026-11-27 - new buckets have no robot script; their calls are Seri's (Jeel) |
| B49 | [Second bucket: Seri](B49-second-bucket-seri.md) | B47 | M | Waits on the client |

## The gate

- **No second bucket row on production** until B18 (each call's own script), B28 (held
  people visible), B33 (its own missed-call text) and B34 (calls only where on, and only
  where someone can answer)
  are deployed - without them a second bucket's leads get antibiotics' words.
- **No calls for a second bucket** - they are Seri's, as it has no robot script - until
  B35 to B41, B50 and B51 are deployed.
- **B24 and B25 reach production in the same deploy**: the two-group read without the
  switch-over would text every old contact in the group.

## The order

The suggested path, each group's tickets in number order:

1. A (B01-B06) - each useful on its own, today.
2. B (B07-B12), then C (B14-B19) - the database and the rules, still one bucket.
3. E's B27, F (B33, B34, B50), G (B36-B40, B42) - in any order once their dependencies are in.
4. B35, B41 and B51 once A22 is done.
5. D (B20-B26) once the client says yes to two groups; B28 and B29 with it.
6. B13 in the deploy after B11, B14 and B23 are live.
7. H (B43-B46), then the second bucket (B47-B49) when its content arrives.

## Waiting on

| What | Blocks |
|---|---|
| The client: may the app move leads into a "- taken" group? Is the main group used for anything else? May the antibiotics group's members be moved at the switch-over? | B20, B21, B24, B25, B26, B32 |
| The client: the same staff and calling hours for every bucket? | Built for one team and one set of hours; a team per bucket is new tickets |
| The client: one calling number, or one per bucket? | Built for one number; a number per bucket is new tickets |
| The client: is every bucket eDrugstore? | B37's fields hold the brand per bucket either way |
| The client: the next bucket's content | B47, B49 (B48 dropped) |
| A22 - Seri's first production calls checked | B35, B41 |

## The decisions these tickets build on

All confirmed with Jeel, 2026-11-27, and written into `BUCKETS.md`: the
**Needs review · 2 buckets** tag clears when an agent picks the person up; "active"
means text questions open, an agent holding the person, an open callback, or a review
conversation; "Received" is the newest arrival; "worked" means since this bucket's
conversation began; an old Closed with no reason starts a new bucket, the retired
`wrong_number` does not; two buckets in one read go to the lower bucket id; a broken
knowledge pack stops the API, as today; the "- taken" group is created once per
bucket by the app.
