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

**EZ Texting API notes**
- Quick start: https://developers.eztexting.com/docs/quick-start-guide
- API reference (has a "Try It" button to test calls in the browser): https://developers.eztexting.com/reference
- Base URL: `https://a.eztexting.com/v1`
- Auth: HTTP Basic Auth with the account username + password. No separate API key. Store as `EZT_USERNAME` / `EZT_PASSWORD` in `.env`.
- Send: `POST /v1/messages` with `{ "toNumbers": ["15551234567"], "message": "..." }`. Save the returned message ID to `messages.ezt_message_id`.
- The account is Secure Medical's **live** account. Only send to the `dev-test` group (our own phones). Never touch `weightloss` or any real group.
- **Update 2026-09-14 (Jeel):** the account behind the credentials in `.env` is a **test account**, not the client's live account. The whole account may be used for development, including sending SMS. The line above is kept for history. The `~120,000 contacts` observed on 2026-09-10 (see `docs/EZTEXTING-API.md`) have not been confirmed as fake, so for send tests still prefer a group you created and put your own phone in. Sending is unlocked by setting `EZT_SEND_GROUP` to that group's name.

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

---

## 6. Core flows (see mockup p.2–3 for exact copy)

### New lead (Worker, every 30–60s)
1. Poll EZ Texting Contacts API for the lead group, since last checkpoint (overlap window 5 min).
2. Normalize phone to E.164. `INSERT ... ON CONFLICT DO NOTHING`.
3. Phone on DNC → create lead as `suppressed`, send nothing.
4. Phone seen before with open conversation → set old one `expired`, link new lead to old.
5. Create conversation `open`, step 1. Send opener. Set expiry timer (default 7 days, admin-editable).
6. Advance checkpoint only after success.

### Reply (API webhook `POST /webhooks/eztexting`)
1. Dedupe on `ezt_message_id`.
2. Find conversation `phone = X AND status = 'open'`. None → save as plain inbound message on latest lead, flag `has_unread_inbound`.
3. Text = STOP → `suppressed`, add to DNC, send STOP confirmation.
4. Text in {1,2,3} → save to `q{step}`, add points. If step 3 → `completed`, score + tier, send thanks. Else step+1, send next question.
5. Anything else → first time: send clarification, `invalid_count=1`. Second time: `review`, send review message.
6. Return 200 fast.

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

Build:
1. State machine in `core/` – pure function: `(conversation, incomingText) → (newConversation, messageToSend | null)`. No DB calls inside; easy to unit test.
2. Wire it into the webhook: load conversation → run → save → send
3. Opener sent automatically when worker inserts a new lead
4. STOP handling → `suppressed` + `dnc_list`
5. Invalid reply → clarification once, then `review`
6. Scoring from `scoring_rules` table, tiers from `tiers` table (seed with mockup defaults)
7. Expiry: `expires_at` set on each send; worker marks stale `open` conversations `expired`
8. Resold-lead logic: existing phone → DNC check → expire old open conversation → new lead linked via `previous_lead_id`
9. Queue API: `GET /leads?tier=&source=&since=` returning score, tier, age, q1–q3, computed queue tag
10. Unit tests for the state machine covering: happy path, invalid twice, STOP at each step, reply after completed, reply after expired

Done when:
- A test phone can complete all three questions and lands as `completed` with the correct score
- Every branch on mockup p.3 is reproducible with a real SMS
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
7. Admin (mockup p.8): edit scoring rules and tier thresholds, recalculate existing, edit question copy / clarification / STOP text / expiry days, manage agents
8. Superadmin overview: all activity across agents
9. Caddy serves the built frontend; API under `/api`

Done when:
- Two agents logged in at once cannot claim the same lead
- Superadmin changes a scoring rule → next completed lead uses the new value
- Every screen in the mockup exists and works with sandbox data

### Week 4 – Twilio calling + end-to-end testing + handoff

**Goal:** agents can call from the browser, and the whole system is tested and ready for Jeel to deploy.

Build:
1. Twilio module: mint Voice access token, TwiML App voice webhook `POST /webhooks/twilio/voice`, status callback
2. Call button in agent workspace using Twilio Voice JS SDK; live timer; hang up
3. Save each call to `calls` (sid, duration, outcome); show in timeline
4. DNC disposition suppresses number for both SMS and calls
5. Error handling and retries: EZ Texting API down, webhook duplicate, Twilio token expiry
6. Logging: every worker tick, every webhook, every send, every call
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
- Read `docs/Secure-Medical-Call-Center-Mockup.pdf` for screen layouts and the reply-handling flow (page 3 is the state machine).
- Read `docs/DESIGN-PROMPT.md` before any frontend work.
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
