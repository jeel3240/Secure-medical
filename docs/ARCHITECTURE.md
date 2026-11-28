# Architecture

The app takes in new leads from EZ Texting, the client's SMS platform, and texts
each one a short qualification flow; it scores the answers and puts the leads who
need a person in a priority queue, HOT, WARM or LOW. About ten call-center agents
call those leads from the browser through Twilio. Leads who never reply get an
automated call - the robot's script, or Seri, the AI agent - which puts a "yes"
through to a person who is free. A superadmin sees everything, and the
configuration read-only. The traffic is small and steady: 50-100 leads a day. No
HIPAA. The code is one Node 20 TypeScript codebase in `backend/`, run as two
processes, a React app in `frontend/`, and the compose files and `caddy/` at the
root; a lead's whole life is `LEAD-FLOW.md`.

## The parts

One EC2 instance runs everything but the database, with Docker Compose:
`docker-compose.yml` everywhere, with `docker-compose.prod.yml` laid over it on the
server (`DEPLOY.md`). The database is RDS Postgres, outside the instance, so the
data survives if the server dies.

| Part | What it does | Where | Code |
|---|---|---|---|
| `caddy` | The front door: HTTPS on ports 80 and 443, with automatic Let's Encrypt certificates. Forwards `/api/*` to the api - holding a request up to 10 seconds while the api restarts, so a webhook or Seri's reconnect lands - and serves the React build for every other path; a missing file under `/assets/` answers 404, never the page. Runs with `--watch` and its folder mounted, so a pull that changes the Caddyfile is reloaded by itself | The server only. Its image is `frontend/Dockerfile`: the React app built, then copied into `caddy:2` | `caddy/Caddyfile`, `frontend/Dockerfile` |
| `api` | Express 4. Every route is under `/api`: the screens' endpoints, sign-in, the EZ Texting and Twilio webhooks, call tokens, and Seri's relay, a WebSocket at `/api/ai/relay`. Two watchers run in it on a timer: leads on hold, every 30 seconds (`api/hold-watch.ts`), and calls whose end never reached us (`api/left-open.ts`). On Docker's stop it hands Seri's calls back to Twilio to reconnect | Locally and on the server | `backend/src/api/index.ts` starts it; `api/app.ts` builds the Express app |
| `worker` | The same codebase, another start command (`npm run worker`): one serialised loop - poll EZ Texting, expire quiet conversations, retry first questions, fetch transcripts, place the robot's calls - each cycle under a Postgres advisory lock (`db/locks.ts`), so two workers never do the same work | Locally and on the server | `backend/src/worker/index.ts` (`POLLER.md`) |
| `redis` | Redis 7. Both compose files start it and set `REDIS_URL`; no code reads or writes it | Locally and on the server | - |
| Postgres | Postgres 16. Locally the `postgres` container on host port 5433; on the server RDS. Changed only by numbered SQL migrations (`WORKFLOW.md`, "Migrations"; `SCHEMA.md`) | Container / RDS | `backend/src/db/`, `backend/scripts/migrate.js` |
| The frontend | React 18, built by Vite. Locally the Vite dev server on :5173, forwarding `/api` to the api; on the server, files in the `caddy` image | Dev server / `caddy` | `frontend/src/` (`FRONTEND.md`) |

The api and the worker build from one `backend/Dockerfile` with two stages: `dev`,
every dependency and ts-node, which local compose runs with `src/` mounted; and
`production`, the compiled `dist/` and production dependencies only, as the `node`
user, which the server runs (`DEPLOY.md`, "The images").

**Where the code is.** One folder per concern; each file's line is in the Code
table of the doc that owns it.

| Folder | What is in it |
|---|---|
| `backend/src/api/` | Routes and webhooks; `auth/`, `users/` and `admin/`; `app.ts` builds the app, `index.ts` starts it, `deps.ts` and `http.ts` are shared plumbing |
| `backend/src/worker/` | The loop (`index.ts`) and its tasks |
| `backend/src/core/` | The pure rules, with no database: the SMS state machine and answer matching, message rendering, the call script, the robot's timing and pace, call and disposition rules, the queue's tags |
| `backend/src/db/` | The SQL, a file per area; `migrations/`; `pool.ts` |
| `backend/src/integrations/` | EZ Texting's client; everything asked of Twilio |
| `backend/src/ai/` | Seri, every AI file (`AI-AGENT.md`) |
| `backend/src/cli/` | The server's commands: `create-superadmin`, `twilio-configure`, `send-waiting-openers`, `ai-agent` |
| `backend/src/lib/` | `log.ts`, structured logging (`LOGGING.md`) |
| `backend/src/` | `config.ts`, `twilio-settings.ts`, `auto-calls-settings.ts` - the environment, read (`ENVIRONMENT.md`) |
| `backend/scripts/` | `migrate.js`; the live checks, the end-to-end script, the speed check and the replays (`TESTING.md`); local-only dev scripts |
| `frontend/src/` | `api/` (one file per area, and `usePolling.ts`), `auth/`, `layout/`, `pages/`, `components/`, `lib/`, `styles/` (`FRONTEND.md`) |
| `data/edrugstore-site/` | The edrugstore.com crawl Seri's knowledge was written from - reference only, never read by the app (`AI-KNOWLEDGE.md`) |
| `docs/` | Every doc but `CLAUDE.md` and the root `README.md` - `docs/README.md` is the index |

## How they connect

```
   Browsers - agents, superadmin       EZ Texting              Twilio
        │ HTTPS                        │ a reply, posted       │ webhooks, and Seri's
        │                              │ to the webhook        │ relay WebSocket
        ▼                              ▼                       ▼
 ┌─ EC2 instance, Docker Compose ───────────────────────────────────────┐
 │  caddy    ports 80, 443 - automatic TLS                               │
 │    ├── /api/*  ─────────────►  api      Express, port 3000            │
 │    └── every other path:       the React build, in the caddy image    │
 │                                worker   the same code, one loop       │
 │                                redis    runs; nothing uses it         │
 └──────────────────────────────────────┬────────────────────────────────┘
                                        │ the api and the worker, a pool each
                                        ▼
                                 RDS Postgres 16
```

What leaves the server, and from where:

| From | To | What |
|---|---|---|
| worker | EZ Texting | Lists new contacts every 30 seconds; sends each new lead's first question, and retries one that failed (`POLLER.md`) |
| api | EZ Texting | Every other text: the next question after a reply, an agent's text, the missed-call text, the link a lead said yes to (`STATE-MACHINE.md`, "Sending") |
| worker | Twilio | Places the robot's calls (`AUTO-CALLS.md`); fetches recordings' transcripts (`TWILIO.md`) |
| api | Twilio | Moves a live call - to the hold line, to a person who came free, to the voicemail message; asks how a call ended; checks where the number points. A browser's call token is signed here, with no request to Twilio |
| api | OpenAI | Seri's understand and speak steps, only on a call she takes (`AI-BRAIN.md`) |
| worker | OpenAI | A one-word check, at most once a minute, before placing calls with Seri on (`AI-AGENT.md`) |
| browser | Twilio | A call's audio, straight between the browser and Twilio - never through our server |

**A lead's path through the parts:**

1. The worker finds a new contact in the EZ Texting group, saves the lead and texts
   the first question (`POLLER.md`).
2. The lead replies; EZ Texting posts it to `POST /api/webhooks/eztexting/<token>`
   on the api, which runs the state machine and texts the next question
   (`WEBHOOKS.md`, `STATE-MACHINE.md`). The answers score the lead.
3. A lead who needs a person is in the queue (`QUEUE.md`). An agent picks it up
   and presses Call: the browser takes a token from the api and calls through
   Twilio, and Twilio tells the api about the call by webhook (`TWILIO.md`). A lead
   who rings our number rings an agent's browser the same way
   (`INCOMING-CALLS.md`).
4. A lead who never replied is called by the worker, an hour after the first text,
   inside the calling hours (`AUTO-CALLS.md`). Twilio asks the api what to say,
   through the `/api/webhooks/twilio/auto/*` webhooks; with Seri on, Twilio opens
   her WebSocket instead (`AI-AGENT.md`). A "yes" rings a person who is free
   (`AUTO-CALL-TRANSFER.md`).

Every status the lead passes through, drawn, is `LEAD-FLOW.md`.

## Outside services

| Service | What for | How | Owner doc |
|---|---|---|---|
| EZ Texting | Leads and texts | REST API at `https://a.eztexting.com/v1` with Basic Auth: the worker polls the contacts of one group and both processes send; replies come in by webhook. The account behind the development credentials is a test account | `EZTEXTING-API.md` |
| Twilio | Every call | Voice JS SDK (`@twilio/voice-sdk`) in the browser, and the `twilio` library on the server: Programmable Voice, voicemail detection, recordings and transcripts, and ConversationRelay for Seri. Through Twilio, Deepgram listens - to the robot's script and to Seri - and ElevenLabs is Seri's voice; the script speaks with Google's Chirp3-HD voice | `TWILIO.md`, `TWILIO-SETUP.md`, `AUTO-CALL-SCRIPT.md`, `AI-RELAY.md` |
| OpenAI | Seri's brain | The `openai` library: `gpt-5.4-mini` understands what the lead said, `gpt-4.1-mini` words her reply, and what she does next is decided in code between them | `AI-BRAIN.md` |
| AWS | Hosting | One EC2 instance running Docker Compose; RDS Postgres; CloudWatch for the logs, log group `/leads-app` in `us-east-2`, one stream per service (`DEPLOY.md`); S3 for optional extra `pg_dump` copies | `DEPLOY.md` |

**Backups are RDS's.** Automatic backups with enough retention and point-in-time
restore, deletion protection on the instance, and optionally a daily `pg_dump` to
S3 - AWS settings, checked by Jeel. The activity log protects the record against
the app and against edits (`AUDIT.md`), not against losing the database.

## Decisions

| Decision | By | Date |
|---|---|---|
| One EC2 instance with Docker Compose running Caddy, the api, the worker and Redis; Postgres on RDS outside it - not Lambda and API Gateway (below) | Jeel | 2026-09-10 |
| Our own `users` table, bcrypt and a JWT - not Supabase, not Cognito (below; `AUTH.md`) | Jeel | 2026-09-10 |
| Caddy, not Nginx (below) | Jeel | 2026-09-10 |
| Postgres on RDS - not DynamoDB, not Postgres on the instance (below) | Jeel | 2026-09-10 |
| The worker is a plain serialised loop, with no job queue: one process, one cycle at a time | Jeel | 2026-09-14 |
| Migrations are plain numbered `.sql` files run by `backend/scripts/migrate.js` - no Prisma, no node-pg-migrate | Jeel | 2026-09-14 |
| Every route under `/api`, the only path Caddy forwards to the api; everything else is the frontend | Jeel | 2026-09-15 |
| The unused `bull` and `redis` packages removed; Redis left running in the compose files | Jeel | 2026-09-28 |
| EZ Texting is polled for new leads by the long-lived worker - it sends nothing when a contact appears (`POLLER.md`, "Why polling") | Jeel | 2026-09-10 |
| The screens poll the api every 5 seconds from one hook, not a push (`FRONTEND.md`) | Jeel | 2026-09-23 |

### Why not Lambda and API Gateway

Lambda is right for bursty, stateless apps with no background work. This is the
opposite:

1. **The poller runs for ever.** New leads are found by polling EZ Texting every
   30-60 seconds. Lambda runs and exits, and its shortest schedule is a minute; a
   loop in a long-lived process is the right tool.
2. **Cold starts hurt webhooks.** EZ Texting and Twilio expect fast answers. A 1-2
   second cold start after idling risks timeouts and retries - duplicate
   processing.
3. **Database connections.** Each Lambda instance opens its own connection and
   needs a pooler; one process on EC2 holds one pool.
4. **Complexity.** IAM roles, VPC configuration from Lambda to RDS, packaging,
   versions, API Gateway stages - all for 100 leads a day. The client's operations
   team can run `docker compose restart`; they cannot debug Lambda.
5. **Cost is not the driver.** Both are cheap at this scale. Simplicity and
   handover are.

### Why not Supabase

- The app needs an always-on server anyway - the poller, the webhooks, Twilio.
  Supabase would be a second vendor for auth and the database when the client
  already offered AWS.
- The sign-in it needs is small (`AUTH.md`); Supabase Auth's features would go
  unused.
- Client-owned AWS is a clean handover, with no account to transfer.

### Why not Cognito

- A superadmin creates agents' accounts and agents sign in with email and
  password: no signup, no social login, no MFA asked for.
- A `users` table, bcrypt and a JWT cover that in a day; Cognito adds IAM and
  console overhead for nothing.

### Why Caddy, not Nginx

- A short configuration and automatic Let's Encrypt certificates; Nginx needs
  Certbot and a renewal job.
- Swappable in an afternoon if the client ever wants Nginx: nothing else depends
  on it.

### Why Postgres on RDS

- The data is relational - leads, conversations, messages, calls, users - with
  reporting queries: SQL, not DynamoDB.
- RDS gives automatic daily backups, point-in-time restore, and data independent
  of the EC2 instance's life.

## History

- 2026-11-27 · Written from `CLAUDE.md` §1-§4 and `docs/README.md`'s "Architecture", checked against the code and the compose files: no BullMQ, no Prisma, the Caddyfile in `caddy/`, Redis running unused, Seri's relay WebSocket, the two watchers in the api · D02
- 2026-11-23 · The Caddyfile moved to `caddy/Caddyfile`, its folder mounted and Caddy run with `--watch`: mounted as one file, a pull swapped the file under it and Caddy kept the old one until recreated by hand · review Q11
- 2026-11-22 · `backend/Dockerfile` in two stages: the server's image had carried every dev dependency, the tests and the dev scripts - guarded only by `NODE_ENV` - installed without the lockfile, and ran as root · review H13
- 2026-11-22 · The local postgres, redis and api ports bound to `127.0.0.1`, the laptop only · review M35
- 2026-11-22 · The worker's whole cycle under an advisory lock: two workers on one database each polled, and sent the same first question twice · review M14
- 2026-11-13 · Caddy holds a request up to 10 seconds while the api restarts, so a call with Seri lives through a deploy · A21
- 2026-11-12 · Seri's relay, a WebSocket at `/api/ai/relay`, opened by Twilio's ConversationRelay through Caddy; OpenAI added as an outside service · A02, A10
- 2026-10-18 · The server places calls itself - the robot's call, from the worker · Phase 6
- 2026-10-01 · Calling: the `twilio` library on the server, `@twilio/voice-sdk` in the browser; the audio never passes through our server · Phase 4
- 2026-09-28 · The `bull` and `redis` packages removed as unused, and `REDIS_URL` no longer required
- 2026-09-15 · Every route under `/api`: Caddy forwards only `/api/*`, so the EZ Texting webhook was built as `POST /api/webhooks/eztexting/<token>`, and the plan's `/webhooks/twilio/voice` and `/twilio/token` became `/api/...` when built
- 2026-09-14 · As built, beside the plan: Express 4; the worker a plain loop in `worker/index.ts` with no job queue; plain numbered SQL migrations; bcrypt and a JWT in a cookie; React 18, Vite 4, React Router 6 and zustand; the production web server the `caddy` service built from `frontend/Dockerfile`; locally no caddy, Postgres on host port 5433, and `docker-compose.prod.yml` as the server's override
- 2026-09-10 · The plan (`ORIGINAL-PLAN.md`): Caddy, an API and a worker from one codebase, and Redis for a job queue and timers, on one EC2 instance (a t3.medium, Ubuntu 24.04); RDS Postgres; S3 for optional dumps. The stack left choices open - Express or Fastify (or FastAPI), BullMQ for jobs and a repeatable poll, Prisma or node-pg-migrate, a `Caddyfile` at the root
