# Secure Medical — Lead Qualification & Call Center

Medical SMS qualification flow + browser-based call center.

## Quick start

```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install
cd ..

# Configure
cp .env.example .env       # then fill in the EZT_* values

# Start services
docker compose up -d

# Create the schema
docker compose exec api npm run migrate

# Watch the poller pick up leads
docker compose logs -f worker
```

The worker logs a line each minute:

```
poll tick fetched=2 inserted=0 skipped=2 suppressed=0 ms=336
```

`inserted` is new leads. To see them:

```bash
docker compose exec postgres psql -U app -d leads \
  -c "SELECT phone, first_name, source, ezt_added_at FROM leads ORDER BY ezt_added_at DESC;"
```

## Environment

| Variable | Notes |
|---|---|
| `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` | Required. |
| `EZT_USERNAME`, `EZT_PASSWORD` | EZ Texting account login. Basic auth, no API key. |
| `EZT_GROUP` | Contact group the poller reads. Required - the account holds ~120k real contacts, so every query is scoped to one group. |
| `EZT_SOURCE` | Defaults to `API`, which is how partner leads arrive. Set to `WebInterface` to test with a contact added by hand in the dashboard. |
| `EZT_SEND_GROUP` | Leave unset. `sendMessage` refuses to send without it - see below. |
| | *Update 2026-09-14:* the account is a test account and `weightloss` is the test group. Set this to `weightloss` and sending is unlocked. See below. |

Never commit `.env`.

## Sending is currently blocked

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

`EZT_SEND_GROUP` is only the on/off switch for `sendMessage`. Wiring the opener
send into the poller is separate work and is not done yet.

## Architecture

- **Backend**: Node + Express + Postgres + Redis
- **Frontend**: React + Vite
- **Deployment**: EC2 (Caddy + Docker Compose) + RDS

## Documentation

Each area has one doc. When you change something, update its doc in the same
commit.

| Doc | Covers | Update it when you change |
|---|---|---|
| `../CLAUDE.md` | Architecture decisions, four-week plan | An architectural decision |
| `SCHEMA.md` | Database tables and why | A migration |
| `POLLER.md` | How leads are pulled in | The poller or worker loop |
| `EZTEXTING-API.md` | Verified API behaviour | You learn something new about the API |
| `WORKFLOW.md` | Branches, PRs, migrations, deploys | The process itself |
| `DESIGN-PROMPT.md` | Frontend design brief | The design direction |
| `Secure-Medical-Call-Center-Mockup.pdf` | All screens; page 3 is the state machine | — |

Docs still to write, as the code arrives: `AUTH.md`, `WEBHOOKS.md`,
`STATE-MACHINE.md`, `TWILIO.md`, `DEPLOYMENT.md`.

## Troubleshooting

**Worker exits immediately.** It is missing a required env var - the message
names it. `EZT_GROUP` is easy to forget.

**`npm error Missing script`.** The container is running a stale image.
`docker compose build worker api` then `docker compose up -d`.

**Cannot connect to Postgres on localhost:5433.** A native PostgreSQL service
may be bound to the same port and winning. Run queries through
`docker compose exec postgres psql` instead, or change the host port in
`docker-compose.yml`.
