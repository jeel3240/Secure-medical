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

### Why NOT Lambda + API Gateway

This came up, so here is the reasoning:

1. **The poller must run forever.** New leads are found by polling EZ Texting every 30–60s. Lambda runs and exits; its minimum schedule is 1 minute. A `while(true)` loop in a long-lived process is the right tool.
2. **Cold starts hurt webhooks.** EZ Texting and Twilio expect fast responses. A 1–2s cold start on idle wake-up risks timeouts and retries (= duplicate processing).
3. **Database connections.** Each Lambda instance opens its own DB connection; needs a pooler. One process on EC2 holds one pool.
4. **Complexity.** IAM roles, VPC config for Lambda→RDS, packaging, versions, API Gateway stages – all for 100 leads/day. The client's ops team can `docker compose restart`; they cannot debug Lambda.
5. **Cost is not the driver.** Both are cheap at this scale. Simplicity and handover are.

Lambda is right for bursty, stateless, no-background-work apps. This is the opposite.

### Why NOT Supabase

- We already need an always-on server (poller, webhooks, Twilio). Supabase would be a second vendor for auth + DB when the client already offered AWS.
- Auth requirement is minimal (see §5). Supabase Auth's features would go unused.
- Client-owned AWS = clean handover, no account transfer.

### Why NOT Cognito

- Requirement: superadmin creates agent accounts; agents log in with email + password. No signup, no social login, no MFA requested.
- A `users` table + bcrypt + JWT covers it in a day. Cognito adds IAM/console overhead for nothing.

### Why Caddy (not Nginx)

- 3-line config, automatic Let's Encrypt certificates. Nginx needs Certbot + renewal cron.
- Swappable in an afternoon if the client ever wants Nginx. Nothing else depends on it.

### Why Postgres on RDS (not DynamoDB, not Postgres on EC2)

- Data is relational (leads → conversations → messages → calls → users) with reporting queries. SQL.
- RDS: automatic daily backups, point-in-time restore, data independent of the EC2 lifecycle. ~$20/mo.

---

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

**As built, 2026-09-14.** Where the table above left a choice open, or the code
went a different way:

| Layer | Actual |
|---|---|
| API | Express 4. Every route is under `/api`. |
| Worker | A plain serialised loop in `backend/src/worker/index.ts`, no job queue. `bull` and `redis` are in `package.json` and Redis runs, but no code uses either yet. |
| Migrations | Plain numbered `.sql` files run by `backend/scripts/migrate.js`. No Prisma, no node-pg-migrate. |
| Auth | bcrypt (cost 12) and a JWT in an httpOnly, SameSite=Strict cookie. See `docs/AUTH.md`. |
| Frontend | React 18, Vite 4, React Router 6, zustand, plain CSS with design tokens. |
| Production web server | The `caddy` service is built from `frontend/Dockerfile`: the React build copied into a `caddy:2` image. |

**EZ Texting API notes**
- Quick start: https://developers.eztexting.com/docs/quick-start-guide
- API reference (has a "Try It" button to test calls in the browser): https://developers.eztexting.com/reference
- Base URL: `https://a.eztexting.com/v1`
- Auth: HTTP Basic Auth with the account username + password. No separate API key. Store as `EZT_USERNAME` / `EZT_PASSWORD` in `.env`.
- Send: `POST /v1/messages` with `{ "toNumbers": ["15551234567"], "message": "..." }`. Save the returned message ID to `messages.ezt_message_id`.
- The account is Secure Medical's **live** account. Only send to the `dev-test` group (our own phones). Never touch `weightloss` or any real group.
- **Update 2026-09-14 (Jeel):** the account behind the credentials in `.env` is a **test account**, not the client's live account. The whole account may be used for development, including sending SMS. The line above is kept for history. The `weightloss` group is the **test group**: add contacts to it by hand in the dashboard (they arrive with source `WebInterface`) and send to it. Test settings: `EZT_GROUP=weightloss`, `EZT_SOURCE=WebInterface`, `EZT_SEND_GROUP=weightloss`. Partner leads in production arrive with source `API`.

---

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

All documentation lives in `docs/`, except `CLAUDE.md`. Keep it that way: when
you change something the docs describe, update the doc in the same commit.

**As built, 2026-09-14.** The tree above is the target. What exists today also includes:

```
  docker-compose.prod.yml   server-only override: RDS, no exposed ports, caddy service
  Caddyfile.dev             not used by anything; local dev goes through Vite
  backend/
    scripts/migrate.js      migration runner
    src/api/auth/           sign-in, sessions, guards
    src/api/users/          superadmin account management
    src/api/admin/leads.ts  Admin > Leads query endpoint
    src/api/leads.ts        the agents' priority queue, and claim/release
    src/db/claims.ts        claiming and releasing a lead
    scripts/claims-live-check.ts  proves that SQL, including the claim race
    src/core/queue-tags.ts  which tag a queued lead gets
    src/db/queue.ts         the priority queue SQL
    scripts/queue-live-check.ts  proves that SQL against a real database
    src/api/webhooks.ts     inbound SMS from EZ Texting
    src/core/messages.ts    renders outbound copy ({first_name}, segment limit)
    src/core/state-machine.ts  the SMS flow, pure; scoring and tiers
    src/core/answers.ts     matches a reply to an option, pure
    src/api/reply-flow.ts   runs the state machine for an inbound reply
    src/worker/expiry.ts    marks stale open conversations expired
    src/db/leads.ts         Admin > Leads SQL
    src/cli/                create-superadmin
    src/integrations/       EZ Texting client
    src/db/users.ts         user queries; src/db/pool.ts
  frontend/
    Dockerfile              production Caddy image with the built app
  docs/
    AUTH.md  POLLER.md  WORKFLOW.md  WEBHOOKS.md  ADMIN-LEADS.md  STATE-MACHINE.md
    QUEUE.md
```

`core/` holds message rendering, the state machine and answer matching, all of
it now driven from the webhook through `api/reply-flow.ts`. `docker-compose.yml`
is local only; production layers `docker-compose.prod.yml` on top of it.

`api` and `worker` build from the same Dockerfile; only the start command differs.

---

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

**As built, 2026-09-14.** `backend/src/db/migrations/001_init.sql` is the source
of truth and `docs/SCHEMA.md` explains it. It differs from the list above:

- **users** also has `session_version` and `last_login_at`.
- **leads** has `group_id`, `group_name` and `ezt_added_at` instead of `group` and `ezt_contact_id`; EZ Texting returns no contact id.
- **messages** also has `in_reply_to_ezt_id`, `from_number` and `received_at`; `ezt_message_id` is unique for outbound only.
- **calls** also has `ended_at`.
- **leads.previous_lead_id** exists but is unused and expected to be dropped - see §6.
- **leads.assigned_at** records when an agent claimed the lead. Claims do not expire; it is what lets a superadmin see one held too long. Added 2026-09-15.

---

## 6. Core flows (message copy is seeded in `settings` by `001_init.sql`; the flow itself is specified in `docs/STATE-MACHINE.md`)

### New lead (Worker, every 30–60s)
1. Poll EZ Texting Contacts API for the lead group, since last checkpoint (overlap window 5 min).
2. Normalize phone to E.164. `INSERT ... ON CONFLICT DO NOTHING`.
3. Phone on DNC → create lead as `suppressed`, send nothing.
4. Phone seen before with open conversation → set old one `expired`, link new lead to old.
5. Create conversation `open`, step 1. Send opener. Set expiry timer (default 7 days, admin-editable).
6. Advance checkpoint only after success.

**Update 2026-09-14.** Step 4 has since been reversed: one person is one lead
row, and a returning phone gets a new conversation on the existing lead rather
than a new linked lead. The design and what it is blocked on are in
`docs/POLLER.md` under "Not done yet". As built, the poller does steps 1-3, 5
and 6, including setting `expires_at` when the opener goes out. Step 4 is a
future item (§10, "Future").

### Reply (API webhook `POST /api/webhooks/eztexting/<token>`)

How a reply is handled - opt-outs, valid answers and the accepted words,
unclear replies, scoring, expiry - is specified in `docs/STATE-MACHINE.md`, and
only there. It overrides the mockup PDF where they differ: Jeel's decision,
2026-09-19, the mockup is a reference for screens and wording, not for flow
logic. What the webhook itself does before the state machine runs - dedupe,
ignoring numbers we hold no lead for - is in `docs/WEBHOOKS.md`.

### Scoring (defaults, admin-editable)
Responded +10 · Completed +10 · Q1: 5/10/15 · Q2: 30/20/5 · Q3: 35/25/10
Tiers: HOT 75–100, WARM 45–74, LOW 1–44

### Call (agent browser)
1. `GET /twilio/token` → API mints Voice access token.
2. Browser SDK dials; Twilio hits `POST /webhooks/twilio/voice` for TwiML.
3. On end, Twilio status callback → save to `calls`.
4. Agent sets disposition/note/callback. DNC disposition = same as SMS STOP.

Queue tags (New, Attempted 1x, In progress, Callback, Needs review, Stalled at Q2, Inbound reply, Seen before) are **computed** from these tables, not stored as a status. *(2026-09-19: "Seen before" cannot occur until repeat-lead handling is built - a future item, §10.)* *(2026-09-22: built - which tag wins when several apply is in `docs/QUEUE.md`.)*

**Paths, as of 2026-09-15.** Caddy forwards only `/api/*` to the API; everything
else is the frontend, so every route lives under `/api`. The EZ Texting webhook
was built that way: `POST /api/webhooks/eztexting/<token>`, unauthenticated,
with a random path segment in place of a signature - see `docs/WEBHOOKS.md`. The
Twilio paths above, `/webhooks/twilio/voice` and `/twilio/token`, still need the
same treatment when they are built. The queue API was built that way:
`GET /api/leads`, 2026-09-22.

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

**Corrections, 2026-09-14.** `docs/README.md` has the current steps. Differences from the above:

- The local compose file starts **postgres, redis, api and worker**. There is no caddy locally; the frontend runs on the Vite dev server.
- Postgres is on host port **5433**, not 5432.
- After migrating, create the first account: `docker compose exec api npm run dev:create-superadmin -- you@example.com "Your Name"`.
- Colima works in place of Docker Desktop.

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
   *(2026-09-14: the full command includes the production override - `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`. `docs/WORKFLOW.md` has the exact steps.)*
4. Developer never touches EC2, RDS, or client accounts.

**Migrations:** plain files in `backend/src/db/migrations/`, numbered. Never edit one that has already run on RDS – add a new one. *(2026-09-23: production is live, so every database change is a new migration file and nothing else - no hand-edits, no psql. `docs/WORKFLOW.md`, "Migrations".)*

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

### Phases, and what Phase 3 is - decided by Jeel, 2026-09-23

The weeks below are the original plan. Work is now tracked in phases, which map
onto them:

| Phase | Weeks | State |
|---|---|---|
| 1 | Week 1 | Done |
| 2 | Week 2 | Done, approved 2026-09-23 |
| 3 | Week 3 **and all of Week 4 except Twilio** | Next |
| 4 | Week 4 items 1-4, Twilio calling | After Phase 3 |

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
| Message copy (6c) | Seven editable fields | Read-only, shown on the same page as the score table |
| Settings (6f) | Expiry, delivery type, poll interval, caller ID | Not built. Expiry stays 7 days; the rest stay environment variables |
| DNC list (6e) | Table plus **Add manually** | Read-only. Blocking happens through an agent's DNC disposition, a STOP reply, or an EZ Texting opt-out |
| Agents (6d) | Editable | Unchanged - creating and deactivating accounts is the point of it |

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
| 19 | Workspace right column: note, callback, disposition, Save and next | `DESIGN-PROMPT.md` 3 | 6, 7, 8 |
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
  around it.
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
3. One-agent lock: claiming a lead sets `assigned_to`; other agents see "In progress – name"
4. Agent workspace (mockup p.6) minus the call button: lead card, score breakdown, SMS send, note, callback scheduling, disposition, save & next
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
- Only if the client asks: showing responders whose conversation expired in the agents' queue as "Stalled at Qn"

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
   found first. `docs/POLLER.md`, "Returning leads", has the detail.

---

## 12. Working with Claude Code

### The order of work, every time

1. **Understand what is already there.** Read the existing code and the doc for
   that area before changing anything. Do not assume how something works from
   its name, and do not trust a doc over the code if they disagree - check, then
   fix whichever is wrong.
2. **Make the change.**
3. **Verify it.** Run it. A change that has not been executed is not done.
4. **Update the doc, in the same commit.** In depth: what changed, why, and what
   the change does not cover. If no doc exists for that area, create it and add
   it to the table in `docs/README.md`.
5. **Open a PR into `dev`.** Never commit to `main` or `dev` directly.

Skipping step 1 is how the `createdAt` bug got written: the plan's field names
were taken on trust and the poller silently ingested nothing.

### Reading first

- Read `docs/EZTEXTING-API.md` before touching the poller, sender, or webhook. It has verified endpoints and field names.
- Read `docs/SCHEMA.md` before changing the data model or writing a migration.
- Read `docs/Secure-Medical-Call-Center-Mockup.pdf` for screen layouts and wording. Its page 3 sketches the reply flow, but `docs/STATE-MACHINE.md` overrides it (2026-09-19).
- Read `docs/DESIGN-PROMPT.md` before any frontend work.
- Read `docs/STATE-MACHINE.md` before any Week 2 work. It is the flow spec and overrides the mockup where they differ.
- Read `docs/AUTH.md` before touching sign-in, sessions, roles or the users table.
- Read `docs/POLLER.md` before changing the worker loop, and `docs/WORKFLOW.md` for branches, migrations and deploys.
- **Every area has one doc, and it is updated in the same commit as the change.**
  Not afterwards, not in a follow-up. `docs/README.md` maps each doc to what
  changes should trigger an update. New area, new doc - add it to that table.
  A finding that cost time to establish belongs in a doc, not just a commit
  message.
- Production settings live in `docker-compose.prod.yml`. Never put real credentials in any committed file.
- Prod `api` and `worker` must run compiled `dist/` output, not ts-node.
- **Every change reaches the repo through a PR into `dev`.** Branch off `dev`,
  push the branch, open the PR against `dev` - never against `main`, and never
  by committing to either directly. Jeel merges `dev` into `main`.
- Prefer small PRs, one concern each. Run `npm test` before opening one, and
  `docker compose build api worker` - a local `node_modules` can hide a
  dependency missing from `package.json`.
