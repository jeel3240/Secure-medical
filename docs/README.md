# Secure Medical — Lead Qualification & Call Center

Medical SMS qualification flow + browser-based call center.

## Quick start

Prerequisites: Docker (Docker Desktop or Colima), Node 20, Git.

```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install
cd ..

# Configure
cp .env.example .env       # then fill in the EZT_* values. The Twilio lines
                           # are empty: calling is off until all seven are set

# Start services
docker compose up -d

# Create the schema
docker compose exec api npm run migrate

# Create the first superadmin (prints a one-time temporary password)
docker compose exec api npm run dev:create-superadmin -- you@example.com "Your Name"

# Watch the poller pick up leads
docker compose logs -f worker

# In a second terminal: start the frontend, then open http://localhost:5173
cd frontend && npm run dev
```

The frontend dev server forwards `/api` to the API on port 3000. Local Docker
runs postgres, redis, api and worker only; Caddy is used in production.

**Stopping for the day.** `docker compose stop` keeps all data. Stop the
frontend with Ctrl+C. On Colima, `colima stop` frees the VM's memory. Next time:
`colima start`, `docker compose up -d`, `cd frontend && npm run dev`.

The worker logs a line on every poll - every 30 seconds by default - as JSON - `LOGGING.md` lists every event:

```
{"ts":"2026-09-28T23:50:24.426Z","level":"info","event":"poll.tick","svc":"worker","fetched":2,"inserted":0,"skipped":2,"suppressed":0,"openers":0,"ms":336}
```

**Locally, `docker compose logs` is how you read that.** On the server it
returns nothing: the production override ships container output to CloudWatch
instead, log group `/leads-app`, one stream per service - `api`, `worker`,
`caddy`. `WORKFLOW.md`, "Deploying", has the detail.

`inserted` is new leads. To see them:

```bash
docker compose exec postgres psql -U app -d leads \
  -c "SELECT phone, first_name, source, ezt_added_at FROM leads ORDER BY ezt_added_at DESC;"
```

## Environment

| Variable | Notes |
|---|---|
| `DATABASE_URL`, `JWT_SECRET` | Required. In production `JWT_SECRET` must be at least 32 characters and not a placeholder, or the API refuses to start - see AUTH.md. |
| `EZT_USERNAME`, `EZT_PASSWORD` | EZ Texting account login. Basic auth, no API key. |
| `EZT_GROUP` | Contact group the poller reads. Required - the account holds ~120k real contacts, so every query is scoped to one group. |
| `EZT_SOURCE` | Defaults to `API`, which is how partner leads arrive. Set to `WebInterface` to test with a contact added by hand in the dashboard. |
| `EZT_SEND_GROUP` | Leave unset. `sendMessage` refuses to send without it - see below. |
| | *Update 2026-09-14:* the account is a test account and `weightloss` is the test group. Set this to `weightloss` and sending is unlocked. See below. |
| `EZT_WEBHOOK_TOKEN` | Random string forming the last segment of the inbound webhook path. Optional locally, where unset accepts the plain path. **Required in production**: the API refuses to start without one of at least 16 characters (2026-09-29). See WEBHOOKS.md. |
| `REDIS_URL` | Not read by any code (2026-09-28). Redis runs in the compose files for a planned job queue; the `bull` and `redis` packages were removed as unused. |
| `NODE_ENV` | `production` turns on the Secure cookie flag, RDS SSL, and the three start-up refusals: a weak `JWT_SECRET`, no `EZT_WEBHOOK_TOKEN`, and Twilio settings only partly set. Set by the compose files; no need to change it in `.env`. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_PHONE_NUMBER`, `PUBLIC_URL` | Browser calling (`TWILIO.md`). All empty: calling is off and everything else works. All set: calling is on. Some set: off locally with a warning, and **the API refuses to start in production**. Where each comes from is in `.env.example`. |
| `TWILIO_TRANSCRIPTION_SERVICE_SID` | Optional, apart from the seven. Set, every call is recorded and transcribed (`TWILIO.md`, "Recordings and transcripts"); empty, nothing is recorded. `npm run twilio:configure -- --transcription` creates the service and prints the id. Needed by both the api and the worker |
| `PORT`, `SERVICE_NAME` | Not in `.env.example`; set by the compose files where needed. `PORT` is the API's port, 3000 by default. `SERVICE_NAME` is the `svc` field on every log line (`api`, `worker`). |
| `CADDY_DOMAIN` | Not read by anything. The production `Caddyfile` names `dailyleadhub.com` directly. |

Never commit `.env`.

## Sending (was blocked until 2026-09-15)

This is a live EZ Texting account with real customer contacts. `CLAUDE.md`
permits sending only to a `dev-test` group of our own phones, and no such group
exists yet, so `sendMessage` throws unless `EZT_SEND_GROUP` is set.

The poller therefore ingests leads but does not send the opening question. That
is deliberate, not unfinished.

**Update 2026-09-14 (Jeel):** the account is a test account, not the client's
live account, so the block above no longer needs to stay in place. The text is
kept for history. To unlock sending:

1. In the EZ Texting dashboard, add your own phone number to the `weightloss`
   group. It is the test group; contacts added by hand arrive with source
   `WebInterface`.
2. In `.env`, set `EZT_GROUP=weightloss`, `EZT_SOURCE=WebInterface` and
   `EZT_SEND_GROUP=weightloss`.
3. `docker compose up -d worker api` so the new values are picked up.

`EZT_SEND_GROUP` is only the on/off switch for `sendMessage`. It is checked
again immediately before every send, together with `dnc_list`, so a number that
opted out is refused however the send was triggered.

**Update 2026-09-15:** sending is live. The poller now sends question 1 when it
creates a lead and records it in `messages`, so with `EZT_SEND_GROUP` set, a new
contact in the group gets a text within a poll interval. `openers` in the
`poll.tick` line says how many went out. POLLER.md has the detail.

## How to test

```bash
cd backend  && npm test && npm run lint    # 626 tests
cd frontend && npm test && npm run lint    # 272 tests   (counts as of 2026-10-06)
```

**Unit and route tests** mock the database and cover behaviour in isolation.

**Live checks** prove the SQL against a real Postgres, because a mocked pool
says nothing about aggregates, date windows, transactions or races. Each one
refuses to run against a database that holds leads. Its header comment gives
the command to run one by hand. To run them, each on its own scratch database:

```bash
cd backend
scripts/live-checks.sh              # all of them
scripts/live-checks.sh flows queue  # just these
```

**How fast it is with a lot of leads** is a separate check - it loads 50,000
fake leads into an empty scratch database and times the read behind every
screen (`backend/scripts/speed-check.ts`; `QUEUE.md`, "How fast it is"):

```bash
docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE speed'
cd backend
DATABASE_URL=postgres://app:app@localhost:5433/speed node scripts/migrate.js
DATABASE_URL=postgres://app:app@localhost:5433/speed JWT_SECRET=x EZT_USERNAME=x \
  EZT_PASSWORD=x EZT_GROUP=weightloss EZT_SEND_GROUP=weightloss npm run speed -- 50000
```

There are fifteen, covering the SMS flows (a second flow added as rows only),
the queue, claims, the read flag, the lead card,
the timeline, callbacks, dispositions, agent SMS, calls (outgoing, incoming and
missed), the activity log, Admin > Leads, the admin read models, health and
the opener retry.

**The end-to-end script** runs the whole system in one go - a lead arrives,
answers the antibiotics flow's questions through the real webhook, is scored, reaches the queue,
is claimed, worked, dispositioned, and finally blocked:

```bash
docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE e2e'
docker compose cp backend/scripts/end-to-end.ts api:/app/scripts/
docker compose exec -e DATABASE_URL=postgres://app:app@postgres:5432/e2e api   node scripts/migrate.js
docker compose exec -e DATABASE_URL=postgres://app:app@postgres:5432/e2e   -e EZT_SEND_GROUP=stub api npm run e2e
```

Fifty checks. EZ Texting is stubbed at the HTTP boundary, so it proves
everything up to the moment a text would leave the building - and nothing about
whether a real phone buzzes. For that, set the real `EZT_*` values and add your
own number to the test group, as "Sending" above describes.

## Known limits

Things that are true today and will surprise someone who assumes otherwise.

**Calling is simple.** Agents call leads from the browser (`TWILIO.md`, built
2026-10-01). A lead who rings the number back rings one agent's browser - the
one holding them, or who last called them - and otherwise gets a message, a
text and a place in the queue as a missed call, and the agent it rang gets a
callback; there is no call queue and no voicemail (`TWILIO.md`, "Incoming
calls"). An agent's browser must be open and signed in to ring, and a number
we hold no lead for rings nobody. Calls are recorded and transcribed when the
transcription service is set, and the lead hears a recording notice first
(`TWILIO.md`). A call that reaches voicemail is saved as
voicemail, by Twilio's detection, which is not always right. There is no
voicemail drop, transfer or hold, and the recording's audio is not played in
the app. **Never run `twilio:configure` locally with production's phone number or
TwiML App** (2026-10-05): it points both at the laptop and production calling
stops, silently, until it is run on the server again. Local testing needs its
own Twilio number and TwiML App in the local `.env` - `TWILIO.md`, "What it
needs on the Twilio account". Admin > Overview shows no call totals - removed on 2026-09-28
(`ADMIN.md`, "Overview") - though every call is on its lead's timeline.

**Calling is not tested locally** (2026-10-05). The Twilio number is
production's, so a local `.env` keeps the Twilio settings empty and calling
reads "off"; a calling change is proved by tests and checked on the live
server - `TWILIO.md`, "What it needs on the Twilio account".

**The message copy is the client's antibiotics script** (2026-10-05,
`STATE-MACHINE.md`). Five lines in it were drafted here and are waiting for the
client's word: the reply to Special offers, the offers question's "sorry" text,
the numbers on the offers question, its third option "No thanks" with its
reply, and the text after a missed call. Nothing
has been sent to anyone outside the test group, and the end-to-end script
deliberately stops short of a real send. Two of the texts run past 160
characters and cost two segments (`ADMIN.md`, "Configuration").

**The queue and Admin > Leads slow down as leads accumulate.** A lead's place
and status are worked out on every refresh, for every lead ever received:
about 0.2 seconds at 50,000 leads after the fixes of 2026-10-06 (it was 3 to 8
seconds). Past a few hundred thousand it would need a stored "needs a person"
flag - `QUEUE.md`, "How fast it is".

**Two things about the SMS flow are waiting for a decision** -
`STATE-MACHINE.md`, "Open items": "no" to question 3 has no answer of its own,
and a second text sent before the next question arrives is read as its
answer.

**One flow for everyone.** Every new lead gets the one active flow. A flow per
EZ Texting group, and editing a flow from the website, are not built -
`FLOWS.md`, "What this does not cover".

**A returning lead is skipped.** The poller ignores a phone it already holds, so
a lead the partner delivers twice never starts a second conversation. Whether a
re-delivery is even detectable is unverified - CLAUDE.md §10, "Future: repeat
leads", has the one API call that settles it.

**A first question more than a day late is not sent.** If a lead's opener
fails and still has not gone out 24 hours after they arrived, it is never sent
- a first question days late reads as broken. The lead shows a red "!" on its
failed message, and an agent can text by hand. `POLLER.md`, "Retrying a failed
opener".

**The deep health endpoint needs a session.** It is superadmin-only, as
`LOGGING.md` specified, so an uptime service cannot poll it. `GET /api/health`
is open but only proves the process is alive.

**Live updates are polling,** every 5 seconds, from one hook
(`frontend/src/api/usePolling.ts`). Not a push. At 50-100 leads a day nobody can
tell, and replacing it later means rewriting that one file.

**Redis runs but nothing uses it.** It is in the compose files, planned for a
job queue (CLAUDE.md §2); no code reads or writes it, and since 2026-09-28 the
`bull` and `redis` packages are gone and `REDIS_URL` is no longer required. The
worker is a plain loop, not a job queue.

**State and Consent ref have no data behind them.** EZ Texting sends neither, so
both are shown as "-" or a note rather than left off the screen.

## Architecture

- **Backend**: Node + Express + Postgres + Redis (Redis runs; nothing uses it)
- **Frontend**: React + Vite
- **Calling**: Twilio - the `twilio` library on the server, `@twilio/voice-sdk`
  in the browser. Audio goes browser to Twilio, never through our server
- **Deployment**: EC2 (Caddy + Docker Compose) + RDS

*As of 2026-09-14:* all API routes are under `/api`, which is the only path
Caddy forwards to the API. Sign-in uses an httpOnly session cookie (AUTH.md).
In production the frontend is built into the Caddy image from
`frontend/Dockerfile`. Redis runs but nothing uses it yet.

## Documentation

Each area has one doc. When you change something, update its doc in the same
commit.

| Doc | Covers | Update it when you change |
|---|---|---|
| `../CLAUDE.md` | Architecture decisions, four-week plan | An architectural decision |
| `LEAD-FLOW.md` | A lead's whole life on one page: every status, the queue, Wrap up. Start here | Any status, the queue's contents, or Wrap up - alongside the doc that owns the rule |
| `AUTH.md` | Sign-in, sessions, roles, account management | Auth routes, guards or the users table |
| `SCHEMA.md` | Database tables and why | A migration |
| `POLLER.md` | How leads are pulled in | The poller or worker loop |
| `WEBHOOKS.md` | How replies are received | The webhook handler |
| `TWILIO.md` | Browser calling: how a call works, incoming calls and missed calls, what is saved, settings, testing, deploying | Anything about calls, Twilio's webhooks, the Call button, the incoming-call card or the call bar |
| `AUDIT.md` | The activity log and the raw webhook archive: what is recorded, why nothing can be edited or deleted, what it does not cover | **Any new action a person or the system can take** - it records itself, or this doc says why not |
| `ADMIN-LEADS.md` | The superadmin Leads page | That page or its API |
| `QUEUE.md` | The agents' priority queue API: who is in it, the order, the tags | `GET /api/leads`, the queue query or the tag rules |
| `AGENT-WORKSPACE.md` | The agent screens: claiming, timeline, notes, callbacks, dispositions, agent SMS | Any of those endpoints or screens |
| `ADMIN.md` | Admin Overview, Configuration and DNC list, and why admin is read-only | An admin screen other than Leads or Agents |
| `LOGGING.md` | Log format and the health endpoints | Anything logged, or the health routes |
| `FLOWS.md` | How SMS scripts are stored - flows, questions, choices, answers - why, and how to add one | A new or changed flow, or anything about how answers are stored |
| `STATE-MACHINE.md` | The SMS flow: replies, scoring, expiry, sending, repeat leads. Overrides the mockup | The state machine, or any flow decision |
| `EZTEXTING-API.md` | Verified API behaviour | You learn something new about the API |
| `WORKFLOW.md` | Branches, PRs, migrations, deploys | The process itself |
| `FRONTEND.md` | The React app as built: screens, polling, and the decisions behind them | Any frontend change |
| `DESIGN-PROMPT.md` | Frontend design brief | The design direction |
| `Secure-Medical-Call-Center-Mockup.pdf` | All screens. Page 3 sketches the flow, but STATE-MACHINE.md is the authority for it | — |

Docs still to write, as the code arrives: `DEPLOYMENT.md`.

## Troubleshooting

**Worker exits immediately.** It is missing a required env var - the message
names it. `EZT_GROUP` is easy to forget.

**`npm error Missing script`.** The container is running a stale image.
`docker compose build worker api` then `docker compose up -d`.

**Sign-in fails with a server error after pulling.** Your local database was
created before `users.session_version` and `users.last_login_at` were added to
`001_init.sql`. SCHEMA.md has the two-line fix, or rebuild the database.

**`/api` requests return the page's HTML instead of JSON on :5173.** The Vite
dev server restarted without its config, which happens if `vite.config.ts`
briefly disappears, for example while switching branches. Stop it and run
`npm run dev` again.

**Cannot connect to Postgres on localhost:5433.** A native PostgreSQL service
may be bound to the same port and winning. Run queries through
`docker compose exec postgres psql` instead, or change the host port in
`docker-compose.yml`.
