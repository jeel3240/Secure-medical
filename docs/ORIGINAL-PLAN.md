# The original plan

> **This is the brief the app was first built from, kept as it was.** It is not
> updated as the app changes, and much of it was built differently. What is true
> today: `ARCHITECTURE.md` for the parts and why, `LEAD-FLOW.md` for a lead's
> life, each area's own doc for its rules (`docs/README.md` is the index), and
> `DOCS.md`, "The phases", for every phase since. Sections 1 to 9 are the plan as
> first written in `CLAUDE.md`; the notes added beside them as the app was built
> are in the owner docs' History. Section 10 is as it stood in `CLAUDE.md` on
> 2026-11-27, with its notes. Moved out of `CLAUDE.md` 2026-11-27 (doc-tickets D03).

## 1. What we are building

A web app that:

1. Picks up new leads from EZ Texting (the client's SMS platform)
2. Runs a 3-question SMS qualification flow automatically
3. Scores each lead and puts it in a priority queue (HOT / WARM / LOW)
4. Lets call center agents call leads from the browser via Twilio
5. Gives a superadmin a view of everything, plus editable scoring rules

Reference: `Secure-Medical-Call-Center-Mockup.pdf` (8 pages, all screens and the flow logic).

**Volume:** 50–100 leads/day. ~10 agents. This is a small, steady-traffic app. No HIPAA.

---

## 2. Architecture – decided, not open for debate

```
Internet
   │
   ▼
[Caddy]  HTTPS front door, port 443, auto TLS
   │
   ▼
[API]    Node/Express (or FastAPI) – routes, webhooks, Twilio tokens, port 3000
[Worker] Same codebase, different start command – polls EZ Texting, sends SMS, runs timers
[Redis]  Job queue + timers
   │
   ▼
[RDS Postgres]  Managed by AWS, outside EC2, auto backups
[S3]            Optional extra pg_dump copies
```

- **One EC2 instance** (t3.medium, Ubuntu 24.04, Docker Compose) runs Caddy, API, Worker, Redis.
- **RDS Postgres** is the database. Separate from EC2 so data survives if the server dies.
- **Browsers** (agents, superadmin) hit Caddy → API.
- **EZ Texting** is polled by Worker for new leads; posts replies to our webhook.
- **Twilio** provides browser calling. Audio goes directly browser ↔ Twilio, never through our server.

Why not Lambda and API Gateway, Supabase or Cognito, why Caddy and why Postgres on RDS - the reasons still hold, and are `ARCHITECTURE.md`'s Decisions.

## 3. Stack

| Layer | Choice |
|---|---|
| Runtime | Node 20 (TypeScript) |
| API | Express / Fastify |
| Worker | Same repo, `npm run worker`, BullMQ for jobs + repeatable poll |
| DB | Postgres 16 (local: Docker; prod: RDS) |
| Migrations | Prisma (or node-pg-migrate with plain SQL) |
| Cache/queue | Redis 7 |
| Frontend | React (Vite), built to static files, served by Caddy |
| Proxy | Caddy 2 |
| Calling | Twilio Voice JS SDK (browser) + Programmable Voice |
| SMS | EZ Texting REST API + inbound webhook – see below |
| Auth | Email + password, bcrypt/argon2, JWT or session cookie |

**EZ Texting API notes**
- Quick start: https://developers.eztexting.com/docs/quick-start-guide
- API reference (has a "Try It" button to test calls in the browser): https://developers.eztexting.com/reference
- Base URL: `https://a.eztexting.com/v1`
- Auth: HTTP Basic Auth with the account username + password. No separate API key. Store as `EZT_USERNAME` / `EZT_PASSWORD` in `.env`.
- Send: `POST /v1/messages` with `{ "toNumbers": ["15551234567"], "message": "..." }`. Save the returned message ID to `messages.ezt_message_id`.
- The account is Secure Medical's **live** account. Only send to the `dev-test` group (our own phones). Never touch `weightloss` or any real group.

## 4. Repo layout

```
secure-medical/
  backend/
    src/
      api/          routes, webhooks, auth
      worker/       poller, sms sender, expiry timers
      core/         state machine, scoring, dedupe
      db/           migrations, queries
    Dockerfile
    package.json
  frontend/
    src/
  docker-compose.yml        local + prod (prod uses RDS via env)
  Caddyfile
  .env.example
  CLAUDE.md                 must stay at root; Claude Code loads it from there
  docs/                     all other documentation
    README.md               how to run it
    SCHEMA.md               data model
    EZTEXTING-API.md        verified API behaviour
    DESIGN-PROMPT.md        frontend design brief
    Secure-Medical-Call-Center-Mockup.pdf
```

## 5. Data model (9 tables + settings)

- **users** – id, email, password_hash, name, role (superadmin/agent), is_active, must_change_password
- **leads** – id, phone (E.164), first_name, last_name, email, source, group, ezt_contact_id, previous_lead_id, assigned_to, has_unread_inbound, created_at
- **conversations** – id, lead_id, status (open/completed/expired/suppressed/review), step (1–3), q1, q2, q3, invalid_count, score, tier, expires_at
- **messages** – id, lead_id, direction, body, ezt_message_id (unique), sent_by, delivery_status, created_at
- **calls** – id, lead_id, agent_id, twilio_call_sid, started_at, duration_sec, outcome
- **dispositions** – id, lead_id, agent_id, value, created_at
- **notes** – id, lead_id, agent_id, body, created_at
- **callbacks** – id, lead_id, agent_id, scheduled_at, done_at
- **dnc_list** – phone (unique), reason, added_at
- **settings** (key/value), **scoring_rules**, **tiers** – admin-editable

Rule: **only one `open` conversation per phone number, ever.**

## 6. Core flows

### New lead (Worker, every 30–60s)
1. Poll EZ Texting Contacts API for the lead group, since last checkpoint (overlap window 5 min).
2. Normalize phone to E.164. `INSERT ... ON CONFLICT DO NOTHING`.
3. Phone on DNC → create lead as `suppressed`, send nothing.
4. Phone seen before with open conversation → set old one `expired`, link new lead to old.
5. Create conversation `open`, step 1. Send opener. Set expiry timer (default 7 days, admin-editable).
6. Advance checkpoint only after success.

### Reply (API webhook `POST /webhooks/eztexting`)

The text first written here was replaced by a pointer to `STATE-MACHINE.md` once that became the flow's spec; what a reply was to do is in Weeks 1 and 2 below.

### Scoring (defaults, admin-editable)
Responded +10 · Completed +10 · Q1: 5/10/15 · Q2: 30/20/5 · Q3: 35/25/10
Tiers: HOT 75–100, WARM 45–74, LOW 1–44

### Call (agent browser)
1. `GET /twilio/token` → API mints Voice access token.
2. Browser SDK dials; Twilio hits `POST /webhooks/twilio/voice` for TwiML.
3. On end, Twilio status callback → save to `calls`.
4. Agent sets disposition/note/callback. DNC disposition = same as SMS STOP.

Queue tags (New, Attempted 1x, In progress, Callback, Needs review, Stalled at Q2, Inbound reply, Seen before) are **computed** from these tables, not stored as a status.

---

## 7. Local setup

**Prerequisites:** Docker Desktop, Node 20, Git, ngrok account (free).

```bash
git clone <repo>
cd secure-medical
cp .env.example .env          # fill in sandbox keys from Jeel
docker compose up -d           # postgres, redis, api, worker, caddy
docker compose exec api npm run migrate
docker compose logs -f worker  # should show poll ticks
```

Frontend dev: `cd frontend && npm run dev` (Vite on :5173, proxies /api to :3000).

**Webhooks locally:** `ngrok http 3000` → paste the https URL into the EZ Texting sandbox and Twilio test TwiML App. Jeel will give you sandbox access; do not touch production settings.

**Daily:** `docker compose stop` / `docker compose up -d` keeps your data. `docker compose down -v` wipes it.

**Browse tables:** DBeaver / TablePlus → `localhost:5432`, user `app`, pass `app`, db `leads`.


---

## 8. Credentials

| Item | Who holds it | Developer gets |
|---|---|---|
| EZ Texting sandbox API key | Jeel | Yes |
| EZ Texting production key | Jeel | No |
| Twilio test credentials | Jeel | Yes |
| Twilio production | Jeel | No |
| AWS console / IAM user | Jeel | No |
| EC2 SSH key | Jeel | No |
| RDS password | Jeel | No |
| GitHub repo | Both | Write access |

Never commit `.env`. Never use real lead data locally. Generate fake leads.

---

## 9. Workflow

1. Developer branches off `dev`, works there, opens a PR **into `dev`**. Never
   commits to `dev` or `main` directly.
2. Jeel reviews, merges to `dev`, then `dev` to `main`.
3. Jeel SSHs into EC2: `git pull && docker compose up -d --build && docker compose exec api npm run migrate`.
4. Developer never touches EC2, RDS, or client accounts.

**Migrations:** plain files in `backend/src/db/migrations/`, numbered. Never edit one that has already run on RDS – add a new one.

**Definition of done for a task:** works locally end to end with fake data, PR description says how to test it, no console errors, migrations included if schema changed.

---

## 10. Four-week plan

Each week ends with something that can be demonstrated. Do not start the next week's work until the current week's "done when" is met.

### Progress, as of 2026-09-22

| Week | Done | Not done |
|---|---|---|
| 1 | All of it: 1 repo and Docker setup · 2 migrations · 3 auth · 4 EZ Texting client · 5 poller (60s default, admin-editable, not 45s) · 6 inbound webhook (`docs/WEBHOOKS.md`) · 7 ngrok wiring, confirmed with a real text | – |
| 2 | 1 the pure state machine (`core/state-machine.ts`, `core/answers.ts`) · 2 wired into the webhook via `api/reply-flow.ts` · 3 opener sent by the poller · 4 STOP, and the `dnc_list` check now inside `sendMessage` · 5 unclear replies · 6 scoring · 7 expiry (`worker/expiry.ts`) · 9 the queue API (`docs/QUEUE.md`) · 10 tests. The full 3-question flow was walked against the account on 2026-09-21 | Item 8, repeat leads, is a future item |
| 3 | 1 scaffold, login, role-based routing · 7 in part: manage agents · 9 Caddy serves the built frontend · 10 Admin > Leads (`docs/ADMIN-LEADS.md`) | 2-6, 8, the rest of 7 |
| 4 | – | All |

Auth (Week 1) and the Week 3 login were built together, ahead of the Week 1
webhook, at Jeel's request. *(Table updated 2026-09-22.)*

*(Superseded 2026-09-23 by the phases table below. As of 2026-10-01 everything
in this table is done except repeat leads; the poller's interval is 30 seconds,
from a `settings` row, and no screen edits it.)*

### Phases, and what Phase 3 is - decided by Jeel, 2026-09-23

The weeks below are the original plan. Work is now tracked in phases, which map
onto them:

| Phase | Weeks | State |
|---|---|---|
| 1 | Week 1 | Done |
| 2 | Week 2 | Done, approved 2026-09-23 |
| 3 | Week 3 **and all of Week 4 except Twilio** | Done 2026-09-28, merged into `main` |
| 4 | Week 4 items 1-4, Twilio calling | Done 2026-10-01 - `docs/TWILIO.md`. A real call placed and recorded the same day. Incoming calls - ring one agent, text the lead on a missed call, and a callback for the agent it rang - tested by Jeel with real calls and merged into `dev` the same day. Deploying them needs migrations 007 and 008, and `twilio:configure` run on the server. On main and production since 2026-10-05 |
| 5 | Not in the original plan | **Flows** - decided by Jeel, 2026-10-05, before launch: the SMS questions and answers stored as rows so a group with different questions is new rows, not new code; the client's eDrugstore antibiotics script as the first flow; a recording notice on calls. Built on `feat/flows`. Reviewed by three independent reads and a 50,000-lead load test on 2026-10-06, then walked with a real phone the same day - eight paths, all as specified - and merged into `dev`. Deploying it needs migrations 012 and 013. Editing a flow from the website, and a flow per EZ Texting group, are later. `docs/FLOWS.md`. On main and production since 2026-10-06 |
| 6 | Not in the original plan | **Automated calls** - the server calls leads who never replied and puts a "yes" through to a person. T0-T25 done 2026-10-25; every path heard on a real phone 2026-10-27 (T26); the leads already waiting at the switch-on called too, after new leads, 2026-10-29 (T27); a Twilio account problem never uses up a lead's call (T28). On `main` 2026-10-30 with migrations 014 to 020, and live. Five calls at once for each person free, not one - T29, 2026-11-02, migration 021, on `main` through PR #29. `docs/AUTO-CALLS.md` |
| 7 | Not in the original plan | **AI agent** - Seri, from eDrugstore, runs the automated call from the start: she answers questions, handles objections, knows on every turn whether anyone can take the call, and ends each call with a transfer, a call back at a time the lead picks, the link, an opt-out or a goodbye; today's script stays as the backup. Designed 2026-11-11, in 22 tickets. A01 done 2026-11-11: the OpenAI key, and the switch, changed only by `npm run ai-agent -- on\|off` and recorded in the activity log. A03 the same day: the knowledge files checked at start-up - a broken one stops the API. A08 too: migration 022, Seri's columns, her conversation's turns and her call backs. A07: when she may book a call back, in the lead's own time zone - pure, tested on its own. A04: her instructions, built from the knowledge files, the same on every call up to the call's own details. A05: every sentence she is about to say checked for a price, medical advice or a made-up offer. A06: her five actions, defined once - what OpenAI is offered, and what Twilio hands back. A09: the answer test set, 67 cases run against the real model - `gpt-4.1-mini` chosen, 133 of 134 passed, first word in 0.55 s. A02, 2026-11-12: the first test calls on the dev number - her voice picked, Rachel on ElevenLabs's `v4` model; the WebSocket through Caddy, its signature and messages confirmed, and `end` never cuts her last line. A10: the relay - the WebSocket Twilio opens for her, refused unless Twilio signed it, taking a call once and keeping every turn; one fixed line until OpenAI. A11: Seri talks - OpenAI streamed a sentence at a time, each sentence checked, her action ending the call straight after her last line, talked over cut short, and the stop words or key 9 ending the call whatever she would say; first sentence 0.66-0.90 s after the lead's words in a real run. A12: the limits - "are you still there?" after 6 seconds of silence and a goodbye after 6 more, a note to wrap up at three minutes and the call ended 20 seconds later, "One moment..." when OpenAI is slow and the script taking the call (`fallback`) at 8 seconds or when OpenAI, the socket or the relay fails; each fallback recorded with why, for A17. A13: with her switch on and the key set, an answered robot call is connected to her - `<Connect><ConversationRelay>` with A02's settings and "Hi, is this Dana?" - instead of the script's first question; off, or no key, exactly today's script. A14: `/auto/ai-after` carries out how her part ended with the script's own code - the transfer, the link, a stop's block, a goodbye's result, once; a stop or the link still carried out when the lead hung up after it; "Sorry about that." and the script's first question when she failed, recorded as a fallback when Twilio's side failed. A15: a call back she books is saved with her result, the lead's own agent's or open to everyone, with her one-line reason (migration 023, `callbacks.note`); shown on the lead's page, its timeline and Admin > Leads; not a person's work. A16: once due it puts the lead at the top of the queue, "Callback · 3:00 PM" in bold, beside a missed "yes"; the first agent to pick the lead up takes it (`callback.taken`) and it is on their My Callbacks. A17: with her on, the robot places nothing while OpenAI does not answer a one-word check (at most once a minute), or for 15 minutes after her last three calls all fell back. A18: voicemail while she talks - the beep decides, as on the script, with what the lead said to her as an answer; her goodbye, the link or a call back waits up to 15 seconds for Twilio's verdict, so a greeting she took for a "no" still gets the voicemail message. A19: her conversation on the lead's timeline, under the call - Lead and Seri lines, then how her part ended - for the agent who takes the transfer or the call back. A20: `npm run e2e` runs her calls - OpenAI down holding the robot back, then a call back, a transfer, the link, a stop and OpenAI failing mid-call - through her real relay with OpenAI stubbed at its HTTP edge; 131 checks. Found in the doc check after A20 and fixed, 2026-11-13: a lead who talked to her had the text questions stop (rule 2d), and her transfer counts as ringing for another call's "yes". A21 (every path on a real phone) and A22 (deploy with her off, then switch her on) are still to do. A23, after them (Jeel, 2026-11-16): a voicemail's menu - "press 1" - taken for a yes and put through, seen twice on production on the script. A21 paused after call 112 (2026-11-17): each fix had been a rule or a note, "less often, not never" - each reply is being rebuilt as three steps, OpenAI understanding what the lead said, tested code deciding what she does next from a record of the call, and OpenAI speaking it (A24-A34, section 12); A24-A32 built 2026-11-17 - every call runs on the new brain, today's kept for a rollback until 2026-11-19, then removed; A33, listening, 2026-11-18 - understanding started early, and Flux's end of turn at 0.6. A34, A21's checklist again on the new brain, Jeel's real-phone test: calls 113-140, 2026-11-17 to 2026-11-22 - every path heard but the three minutes, left to the tests - and call 122's call back on the screens when due; done 2026-11-23, each fault found fixed on its own branch. Then a review of the whole repo, 2026-11-22 (`docs/REVIEW-2026-11-22.md`): every finding fixed or decided on `dev`, 2026-11-23. A22, the deploy: on production 2026-11-24 through PR #31, Seri still off; switching her on next. `docs/AI-AGENT.md`; tracker `docs/ai-agent-tickets/README.md` |
| 8 | Not in the original plan | **Several buckets** - planned 2026-11-25 to 27, not started. Several campaigns at once, each with its own EZ Texting group, text questions, robot script and what Seri knows; one person stays one lead, active in one bucket at a time. Part 2, uploading a list of past customers for reminder calls, is on hold; Part 3, setup screens, comes later. Split into 49 small tickets, B01-B49, with the decisions they build on, 2026-11-27 - about forty can be built before the client answers; the intake tickets wait on them. `docs/BUCKETS.md`; tracker `docs/bucket-tickets/README.md` |

**Phase 3 is everything that is left except calling.** That means the Week 3
list below, plus Week 4 items 5-9: error handling and retries, logging, the
end-to-end test script, the fixes it finds, and the README. Twilio is the only
thing held back, so the agent workspace is built with its Call button visible
but disabled until Phase 4.

Added to Phase 3, not in the original plan:

- **Structured logging and a deeper health endpoint** - `docs/LOGGING.md`.
  Today's logs are readable lines that nothing can query, and the only health
  check proves the API process is alive and nothing more.
- **Clearing `has_unread_inbound`.** Nothing unsets it today, so a lead who
  texts after expiry never leaves the queue. Opening the lead is what clears it.
- **Claiming a lead.** `assigned_to` and `assigned_at` exist and the queue reads
  them, but nothing writes them.

**Admin is read-only except Agents - decided by Jeel, 2026-09-23.** The original
Week 3 item 7 and `DESIGN-PROMPT.md` 6b, 6c, 6e and 6f had the superadmin
editing scoring rules, tier bands, message copy and settings from the screen.
They do not. Admin shows the configuration; it does not change it:

| Screen | Was | Is |
|---|---|---|
| Scoring rules and tiers (6b) | Editable inline, with **Recalculate existing** | A read-only card. No Save, no Recalculate - the feature is dropped |
| Message copy (6c) | Seven editable fields | Read-only, on Configuration's Texts tab; the score table is on its Scoring tab |
| Settings (6f) | Expiry, delivery type, poll interval, caller ID | Not built as an editor. Expiry and the other flow settings are shown read-only on the Texts tab; the poll interval is a settings row, caller ID an environment variable |
| DNC list (6e) | Table plus **Add manually** | Read-only. Blocking happens through an agent's DNC disposition, a STOP reply, an EZ Texting opt-out, or a stop said on the automated call (T13) |
| Agents (6d) | Editable | Unchanged - creating and deactivating accounts is the point of it |
| Seri's switch | - (Phase 7) | *Added 2026-11-24, Jeel:* Switch on / off on Configuration's Calls tab, superadmin only, confirmed, recorded by whoever clicked - the one control on Configuration. `npm run ai-agent` still works |

**Why:** scoring and copy are not small changes. A mistyped point value silently
reshuffles the queue; a broken opener costs a second segment on every message or
drops the STOP wording. Changing them through a numbered migration means a PR, a
review and a git history of who changed what. Jeel makes those changes.

A rule change therefore leaves leads already scored on their old values. That is
accepted: it is rare, and a one-off rescore script can be run deliberately if it
ever matters. Nothing rescores on its own.

### Phase 3 task list

30 tasks, each one a PR. The behaviour of every one is specified in the doc
named beside it - read that first, not this line. §9's definition of done
applies to each: works locally with fake data, tests, docs updated in the same
commit.

**Backend done, 2026-09-26.** Tasks 1-13: the agent workspace endpoints, agent
SMS with rule 2b, the three read-only admin screens and the deep health
endpoint. Suite at 360 tests, plus eight `scripts/*-live-check.ts` files that
prove the SQL against a real Postgres.

**Frontend done, 2026-09-26.** Tasks 14-25, on the same branch: the shared
polling hook, the priority queue with the one-agent lock, the agent workspace
(card, timeline, actions, SMS compose), the lead timeline page, My Callbacks,
and the three admin pages. `docs/FRONTEND.md` is the record of what was built
and why. The frontend gains its first test setup - Vitest, jsdom, tests
covering logic rather than buttons.

**Operations done, 2026-09-28.** Tasks 26-30, on `feat/phase3-operations`:
structured JSON logging with redaction enforced in the logger, the failed-opener
retry, the end-to-end script, and a README with how to test and known limits.
**Phase 3 is complete.** Next is Phase 4, Twilio calling. *(Built 2026-10-01 - `docs/TWILIO.md`.)*

**Open when Phase 3 closed, 2026-09-28** - each written up where it lives:

- ~~**"Today" is UTC.**~~ Fixed 2026-09-28: each viewer's own time zone, sent
  by the browser as `?tz=` - `db/sql.ts`, `startOfTodaySql`.
- ~~**Force-release has no screen.**~~ Built 2026-10-08: a Release button on
  the lead's page, for the holder and for a superadmin on anyone's lead. Back
  to queue no longer releases a lead - `AGENT-WORKSPACE.md`.
- **Source always reads "API" in production** - it is how the contact was
  added to EZ Texting, not which partner sent it. Keep the column, or find the
  partner elsewhere.
- **Deploy:** `npm run migrate` applies whatever the server has not run - which files production holds, and the next number, is `docs/WORKFLOW.md`, "Where the files stand". Seri also needs `OPENAI_API_KEY` in the server's `.env` (set 2026-11-24); she stays off (022 seeds `ai_agent` as `off`) until switched on - the Seri card on Admin > Configuration, or `npm run ai-agent -- on` - which needs no restart. What 005 to 011 were (011: call recordings and transcripts, which also need `TWILIO_TRANSCRIPTION_SERVICE_SID` - `docs/TWILIO.md`; 010: voicemail detection; 009: the word kept with each answer - `docs/STATE-MACHINE.md`; 005, 2026-09-29: poll every 30s; 006, 2026-10-01: the activity log, the raw webhook archive, and leads that cannot be deleted - `docs/AUDIT.md`; 007 and 008, the same day: incoming calls and the callback a missed call books - `docs/TWILIO.md`). Calling also needs the seven Twilio settings - all or none, a partly set group stops the API starting - and `npm run twilio:configure` run on the server, last: the phone number rings only one deployment. Production also needs `EZT_WEBHOOK_TOKEN` set, or the API will not start - it is already set there.

Task 29 found nothing to fix in the app: all three bugs the end-to-end script
surfaced were in the script itself. Two apparent failures were the app being
right and the script being out of date with Jeel's changes.

*(2026-09-28, in review before merging: the retry of task 27 had two faults its
own check did not catch, both fixed on the branch. Its waits counted from the
lead's arrival, so an older lead's four retries fired in four minutes; and
nothing stopped a first question going out days late. The README also still
described two things changed the same day. `POLLER.md`, "Retrying a failed
opener".)*

Two things found while building, neither fixed inside its task, both needing
Jeel:

- **A disposition does not remove a lead from the queue.** `db/queue.ts` does
  not read `dispositions` at all, so a lead dispositioned `not_interested`
  stays in the queue at full score and the next agent picks it up again. Only
  `dnc` removes one, and only through `dnc_list`. *(2026-09-28, Jeel: fixed.
  Wrap up now has two outcomes, Closed and DNC. Closed takes a lead out of the
  queue and reads Closed on Admin > Leads, next to a new Working status.
  `AGENT-WORKSPACE.md`, "Dispositions"; `ADMIN-LEADS.md`.)*
- **The deep health endpoint cannot be polled by external monitoring,** because
  it is superadmin-only as `LOGGING.md` specified. If an uptime service is
  wanted, it needs a separate unauthenticated route returning less. *(Still
  open, 2026-09-28 - `README.md`, "Known limits".)*

**Backend (`AGENT-WORKSPACE.md`, `ADMIN.md`, `LOGGING.md`)**

| # | Task | Doc | Needs |
|---|---|---|---|
| 1 | Migration: agent take-over timestamp on `conversations` | `SCHEMA.md` | – |
| 2 | Claim and release a lead, with superadmin force-release | `AGENT-WORKSPACE.md` | – |
| 3 | Mark a lead read, clearing `has_unread_inbound` | `AGENT-WORKSPACE.md` | – |
| 4 | Lead detail: card, flags, score breakdown | `AGENT-WORKSPACE.md` | – |
| 5 | Lead timeline: merged events from five tables | `AGENT-WORKSPACE.md` | – |
| 6 | Notes | `AGENT-WORKSPACE.md` | – |
| 7 | Callbacks: create, reschedule, mark done, list | `AGENT-WORKSPACE.md` | – |
| 8 | Dispositions, and the DNC path that blocks the number | `AGENT-WORKSPACE.md` | – |
| 9 | Agent SMS, and stopping the automated questions | `STATE-MACHINE.md` 2b | 1 |
| 10 | Admin Configuration: live copy, scoring and tiers, read-only | `ADMIN.md` | – |
| 11 | Admin Overview statistics | `ADMIN.md` | – |
| 12 | Admin DNC list, read-only, showing released rows | `ADMIN.md` | – |
| 13 | Deep health endpoint: database, last poll, last webhook | `LOGGING.md` | – |

**Frontend (`DESIGN-PROMPT.md`)**

| # | Task | Doc | Needs |
|---|---|---|---|
| 14 | Shared polling hook, 5s, one place for every live screen | `QUEUE.md` | – |
| 15 | Priority Queue screen, replacing the placeholder | `DESIGN-PROMPT.md` 2, `QUEUE.md` | 14 |
| 16 | One-agent lock in the queue: claimed rows muted and unclickable | `DESIGN-PROMPT.md` 2 | 2, 15 |
| 17 | Agent Workspace shell: lead card, three columns, Call button disabled | `DESIGN-PROMPT.md` 3 | 4 |
| 18 | Timeline component | `DESIGN-PROMPT.md` 3 | 5 |
| 19 | Workspace right column: note, callback, disposition, Save and next *(2026-09-28: Save only)* | `DESIGN-PROMPT.md` 3 | 6, 7, 8 |
| 20 | Workspace SMS compose, with templates | `DESIGN-PROMPT.md` 3 | 9 |
| 21 | Lead Timeline page, full width with summary sidebar | `DESIGN-PROMPT.md` 4 | 18 |
| 22 | My Callbacks page | `DESIGN-PROMPT.md` 5 | 7 |
| 23 | Admin Configuration page | `DESIGN-PROMPT.md` 6b, 6c | 10 |
| 24 | Admin Overview page | `DESIGN-PROMPT.md` 6a | 11, 13 |
| 25 | Admin DNC page | `DESIGN-PROMPT.md` 6e | 12 |

**Operations (`LOGGING.md`, `README.md`)**

| # | Task | Doc | Needs |
|---|---|---|---|
| 26 | Structured JSON logging across api and worker | `LOGGING.md` | – |
| 27 | Error handling and retries: EZ Texting down, failed opener, duplicate webhooks | `POLLER.md`, `WEBHOOKS.md` | – |
| 28 | End-to-end test script: lead in, SMS flow, queue, disposition, timeline | – | most |
| 29 | Fix what task 28 finds | – | 28 |
| 30 | README: how to run, how to test, env vars, known limits | `README.md` | – |

**Not in the list, and why**

- **Twilio** - Phase 4. Tasks 17 and 19 leave the Call button and the call
  entries in the timeline in place but inert.
- **Repeat leads** - still blocked. The check that unblocks it is one API call
  against the test account, described in "Future: repeat leads" below. Worth
  doing early in Phase 3: if `createdAt` moves on a re-delivered contact, it
  becomes a 32nd task; if it does not, it stays parked and we stop planning
  around it. *(Checked 2026-11-27: it does not move - "Future: repeat leads".)*
- **State and Consent ref** on the workspace and timeline - no data reaches us
  for either. `AGENT-WORKSPACE.md`, "Known gaps in the screens".

### Week 1 – Foundation + prove EZ Texting works

**Goal:** leads are pulled from EZ Texting into our database, and we can send and receive SMS.

Build:
1. Repo structure, `docker-compose.yml`, Dockerfile, `.env.example`, README
2. Migrations for all tables in §5 (empty tables are fine for now)
3. Auth: `users` table, login endpoint, JWT/session, `superadmin` and `agent` roles, superadmin can create/deactivate agents
4. EZ Texting client module: list contacts (with group/source filter), send message
5. Worker skeleton: loop every 45s, poll contacts, insert new leads with dedupe on phone, checkpoint stored in DB
6. Webhook route `POST /webhooks/eztexting`: receive, verify, dedupe on message ID, save to `messages`
7. ngrok wired to sandbox so replies reach the webhook

Done when:
- Add a contact in the EZ Texting sandbox → within 60s it appears in `leads`
- Send an SMS from the app to a test phone → it arrives
- Reply from that phone → row appears in `messages` with correct lead_id
- Restarting the worker does not create duplicate leads

### Week 2 – Conversation engine + scoring

**Goal:** the full 3-question flow runs automatically and every lead ends with a status, score and tier.

This list is the scope. How each item behaves is in `docs/STATE-MACHINE.md`.

Build:
1. State machine in `core/` – a pure function, no database calls, so every rule is unit-testable
2. Wire it into the webhook: load conversation → run → save → send
3. Opener sent automatically when the worker inserts a new lead - **done**
4. STOP handling, and START releasing the block while keeping the record *(added 2026-09-22)*
5. Unclear replies, and answer matching: numbers plus a short list of accepted words
6. Scoring and tiers, updated on every reply
7. Expiry of conversations that go quiet
8. ~~Repeat leads~~ - **future, not Week 2** *(2026-09-19)*. Until then the poller skips a phone it already holds. See "Future" below
9. Queue API: `GET /api/leads?tier=&source=&since=` returning score, tier, age, q1–q3 and the computed queue tag - **done**, `docs/QUEUE.md`
10. Unit tests for the state machine - the list is in `docs/STATE-MACHINE.md`

Not in Week 2: a sending-hours window for the opener (rejected 2026-09-19; it is sent as soon as the lead arrives), and retrying a failed opener.

Done when:
- A test phone can complete all three questions and lands as `completed` with the correct score
- Every rule in `docs/STATE-MACHINE.md` is reproducible with a real SMS
- Queue API returns leads sorted by score then age

### Week 3 – Frontend: queue, agent workspace, timeline, admin

**Goal:** agents and superadmin can use the app end to end, except calling.

Build:
1. React app scaffold, login page, role-based routing
2. Priority queue screen (mockup p.5): HOT/WARM/LOW counts, table, filters, live age ticking, refresh on new data
3. One-agent lock: claiming a lead sets `assigned_to`; other agents see "In progress – name" *(2026-09-28: now "Working – name")*
4. Agent workspace (mockup p.6) minus the call button: lead card, score breakdown, SMS send, note, callback scheduling, disposition, save & next *(2026-09-28: Save only; the outcomes are Closed and DNC)*
5. Lead timeline (mockup p.7): merged view of messages, calls, notes, callbacks, dispositions
6. My Callbacks page
7. Admin (mockup p.8): ~~edit scoring rules and tier thresholds, recalculate existing, edit question copy / clarification / STOP text / expiry days~~, manage agents. *(2026-09-23: all of it read-only except managing agents - see "Phases, and what Phase 3 is" above. The screen shows the questions, the clarifications, the thanks message, the score table and the tier bands; nothing is editable and Recalculate is dropped.)*
8. Superadmin overview: all activity across agents
9. Caddy serves the built frontend; API under `/api`
10. **Admin > Leads** *(added 2026-09-14, not in the original plan)*: superadmin-only list of every lead, including ones that never replied, with status tabs (Awaiting reply, In progress, Completed, Needs review, Opted out, Expired), source and date filters, search, pagination, and row click to the timeline. Read-only. Backed by `GET /api/admin/leads?status=&source=&since=&q=&page=`, superadmin only; status comes from the lead's newest conversation. Spec in `docs/DESIGN-PROMPT.md` section 6g. It needs only the `leads`, `conversations` and `messages` tables, so it can be built before the queue if useful for watching the poller and the SMS flow.

Done when:
- Two agents logged in at once cannot claim the same lead
- A lead added in EZ Texting appears in Admin > Leads as Awaiting reply within one poll interval, without a manual refresh
- ~~Superadmin changes a scoring rule → next completed lead uses the new value~~ *(2026-09-23: rules are not changed from the screen. Instead: the Configuration page shows the values the state machine is actually using.)*
- Every screen in the mockup exists and works with sandbox data

### Week 4 – Twilio calling + end-to-end testing + handoff

**Goal:** agents can call from the browser, and the whole system is tested and ready for Jeel to deploy.

Build:
1. Twilio module: mint Voice access token, TwiML App voice webhook `POST /webhooks/twilio/voice`, status callback
2. Call button in agent workspace using Twilio Voice JS SDK; live timer; hang up
3. Save each call to `calls` (sid, duration, outcome); show in timeline
4. DNC disposition suppresses number for both SMS and calls
5. Error handling and retries: EZ Texting API down, webhook duplicate, Twilio token expiry *(items 5-9 moved into Phase 3, 2026-09-23; Twilio token expiry stays here)*
6. Logging: every worker tick, every webhook, every send, every call - structured, `docs/LOGGING.md`
7. Full end-to-end test script: new lead → SMS flow → queue → call → disposition → timeline
8. Fix everything found in step 7
9. README updated: how to run, how to test, env variables, known limits

Done when:
- A fresh test lead can go from sandbox contact to a completed browser call with disposition, with no manual DB edits
- All unit tests pass
- Jeel can deploy `main` to EC2 following the README without asking questions

### After week 4 (Jeel)

- AWS provisioning, RDS, deploy, DNS, production webhooks
- Client UAT with real agents
- Fixes from UAT
- Later phase (not in scope now): ElevenLabs AI attendant, voicemail, after-hours handling
- Only if the client asks: showing responders whose conversation expired in the agents' queue as "Stalled at Qn" *(2026-09-28: the queue no longer shows partway leads at all, open or expired - Jeel's decision. This would reverse it.)*

### Future: repeat leads - check first, then build

When the same number is delivered again, it should start a new conversation
unless it is mid-flow or blocked. The rules are decided and written in
`docs/STATE-MACHINE.md`, "A number that comes back".

**It is not built yet, because a return may not be detectable.** Verified
2026-09-19 by Jeel: EZ Texting does not allow two contacts with the same phone
number (`docs/EZTEXTING-API.md`). So a re-delivered number never arrives as a
new contact; it is rejected or updates the existing one. The poller finds leads
by the contact's `createdAt`, so unless an update resets that time, the poller
never sees the return and the rules never run.

Before building it:
1. Check on the test account what happens when a number already on the account
   is added again through the API, the way the partner sends leads: is it
   rejected, or does it update the existing contact - and if it updates, do
   `createdAt` or `updatedAt` change?
2. If `createdAt` moves, build the rules as written.
3. If not, the poller needs another signal for a return - for example
   `updatedAt`, a group move, or the partner telling us - and that has to be
   found first. `docs/POLLER.md`, "Not done yet", has the detail.

*(Checked 2026-11-27 on the test account: step 3 applies. A number delivered
again updates the existing contact and `createdAt` does not move; there is no
`updatedAt`. Only the contact's groups change. `docs/EZTEXTING-API.md`, "One
contact per phone number".)*
