# Environment variables

Every environment variable the app reads, and where each is set. Values live in
`.env` at the repo root - copied from `.env.example`, never committed - and the
compose files pass them to the containers: `docker-compose.yml` everywhere, with
`docker-compose.prod.yml` laid over it on the server, where its settings replace
the same ones in the first file. The required ones are checked by
`backend/src/config.ts`, which exits naming the first one missing; browser
calling's are read by `backend/src/twilio-settings.ts`, the automated calls' by
`backend/src/auto-calls-settings.ts`. A changed value reaches a container only when
it is recreated: `docker compose up -d` does it.

## The variables

"Both" is the api and the worker: they share `config.ts`, so a variable it requires
must be set for each even where only one uses it.

| Variable | What | Required | Read by | Set in |
|---|---|---|---|---|
| `NODE_ENV` | `production` turns on the Secure cookie flag, SSL to RDS (`db/pool.ts`, `scripts/migrate.js`), the start-up refusals (`api/startup-checks.ts`), and every lead being callable by the robot - `AUTO_CALL_TEST_NUMBERS` is not read. The dev scripts refuse to run under it. `test` makes bcrypt cheap for the tests | Set by the compose files - no need to put it in `.env` | Both; `scripts/migrate.js`; the dev scripts | `docker-compose.yml`: `development`; `docker-compose.prod.yml`: `production` |
| `DATABASE_URL` | The Postgres connection | Yes | Both; `scripts/migrate.js` | Locally `docker-compose.yml`: `postgres://app:app@postgres:5432/leads`. On the server `.env`: RDS, passed by `docker-compose.prod.yml` |
| `JWT_SECRET` | Signs the session cookie (`AUTH.md`). In production it must be at least 32 characters and not a placeholder (`dev-secret`, `change-me`, ...), or the api refuses to start: `openssl rand -hex 32` | Yes | The api signs with it; the worker only needs it set | `.env`; locally `docker-compose.yml` falls back to `dev-secret` |
| `EZT_USERNAME`, `EZT_PASSWORD` | The EZ Texting account's login - Basic Auth, no API key (`EZTEXTING-API.md`) | Yes | Both | `.env` |
| `EZT_GROUP` | The contact group the poller reads. Every contacts query is scoped to it: the account is large. Locally the test group, `weightloss` | Yes | The worker reads it; the api needs it set | `.env` |
| `EZT_SOURCE` | Which contacts the poller takes in, by their EZ Texting `source`: `API`, how partner leads arrive. `WebInterface` to test with a contact added by hand in the dashboard | No - `API` | The worker | `.env`; compose falls back to `API` |
| `EZT_SEND_GROUP` | **The switch that lets this server send texts**, not a group: unset, `sendMessage` refuses every send; any value turns sending on, and the value itself is never used. Checked again before every send, beside `dnc_list`. The name is from when it was to name a `dev-test` group of our own phones; it stays because production's `.env` sets it. The health check reports it (`LOGGING.md`, "Health endpoint") | No - off, by design: a new server sends nothing until someone means it to. Locally `weightloss` to send | Both | `.env` |
| `EZT_WEBHOOK_TOKEN` | The random last segment of the inbound webhook's path, `/api/webhooks/eztexting/<token>` - EZ Texting sends no signature, so the unguessable path is the only check on who posts (`WEBHOOKS.md`, "The path token"). Unset, the plain path is accepted | **In production**: the api refuses to start without one of at least 16 characters. Not locally | The api | `.env` |
| `TWILIO_ACCOUNT_SID` | The Twilio account, `AC` and 32 hex characters | One of the seven that switch calling on - all or none (below) | Both | `.env` |
| `TWILIO_AUTH_TOKEN` | 32 hex characters. Verifies Twilio's webhook signatures; used by `twilio:configure` | One of the seven | Both | `.env` |
| `TWILIO_API_KEY`, `TWILIO_API_SECRET` | A **Standard** API key, `SK…`, and its 32-character secret, shown once when the key is made. They sign the short-lived token a browser calls with | Two of the seven | Both | `.env` |
| `TWILIO_TWIML_APP_SID` | The TwiML App, `AP…`, whose Voice URL is our `/api/webhooks/twilio/voice` | One of the seven | Both | `.env` |
| `TWILIO_PHONE_NUMBER` | The caller ID leads see, E.164 - a number on the same account. **Production is (480) 470-8259; a laptop holds the dev number, (480) 530-8582, and never production's** (`TWILIO-SETUP.md`, "Before you start") | One of the seven | Both | `.env` |
| `PUBLIC_URL` | This app's public `https://` address, no trailing slash. Twilio signs each webhook against it, and `twilio:configure` points the TwiML App and the number at it. Production: its address; locally a tunnel's, or empty - calling is then off | One of the seven, but alone it does not switch calling on | Both | `.env` |
| `TWILIO_TRANSCRIPTION_SERVICE_SID` | Twilio's transcription service, `GA` and 32 hex characters. Set, every call is recorded and transcribed (`TWILIO.md`, "Recordings and transcripts"); empty, nothing is recorded. `npm run twilio:configure -- --transcription` creates one and prints its id. A malformed one makes calling incomplete | No | Both - the worker fetches the transcripts | `.env` |
| `TWILIO_IDENTITY_PREFIX` | Put in front of every browser's name at Twilio: `dev-` makes user 21 `dev-agent-21`. Twilio rings every browser on the account with the name it is given, whichever number was called, so any copy sharing production's Twilio account sets one. Lower-case letters and digits ending in a hyphen (`dev-`, `jeel-`), at most 20 characters; a malformed one makes calling incomplete rather than being used or dropped (`TWILIO-SETUP.md`, "What it needs on the Twilio account") | No - **empty in production; `dev-` locally** | Both | `.env` |
| `AUTO_CALLS` | Automated calls (`AUTO-CALLS.md`). **On only when exactly `on`**, and only with calling on; `off` or empty is off, and any other value is off and logged once at start, `auto_calls.off` - never a reason to refuse to start. On, the app bar shows the "Taking calls" switch, and the robot calls every lead still waiting for a reply, new leads first. Change it for both containers at once - `docker compose up -d` - or the worker goes on calling while the api answers the call's webhooks 404, until it stops by itself (`auto_call.webhooks_silent`) | No - off. On in production | Both - the worker places the calls; `npm run ai-agent` and `dev:auto-call` | `.env` |
| `AUTO_CALL_TEST_NUMBERS` | Outside production, **the only numbers an automated call may ring** - our own phones, comma-separated E.164: `+16025550123,+16025550124`. Empty, nothing is rung; an entry that is not E.164 is left out and counted at start (`auto_calls.test_numbers_invalid`). Production does not read it (`AUTO-CALLS.md`, "How a call is placed") | No | The worker; `dev:auto-call` | `.env` |
| `OPENAI_API_KEY` | Seri, the AI agent on the automated call (`AI-AGENT.md`). **Empty, she is off whatever her switch says**, and every call gets the script. Her switch is not a variable: it is `settings.ai_agent`, changed with `npm run ai-agent -- on\|off` or on Admin > Configuration, read on every call, so no restart; `on` is refused without the key. Never in the repo, never in a log line | No | Both - the worker checks OpenAI before placing calls; `npm run ai-agent`; the test sets and `ai:replay`, run by hand | `.env` |
| `OPENAI_BASE_URL` | **For tests only - never in `.env`.** Not read by our code: the OpenAI library reads it, and would send Seri's requests, with her key, to that address. `npm run e2e` and the unit tests point it at a local stand-in | No | The OpenAI library | Set by `scripts/end-to-end.ts`; the compose files do not pass it |
| `PORT` | The api's port | No - 3000 | The api | Nowhere: not in `.env.example` nor the compose files |
| `SERVICE_NAME` | Overrides `svc` on every log line, otherwise worked out from the entry point - `api` or `worker` (`LOGGING.md`) | No | Both | Nowhere |
| `REDIS_URL` | Read by no code: Redis runs in the compose files, unused (`ARCHITECTURE.md`) | No | Nothing | `docker-compose.yml`, `.env.example` |

**Browser calling is all or none.** The seven - `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_TWIML_APP_SID`,
`TWILIO_PHONE_NUMBER`, `PUBLIC_URL` - are each checked for their shape. None of the
six `TWILIO_*` set: calling is off and everything else works. All seven set and
well-formed: calling is on. Anything between is *incomplete*: off locally with a
warning (`calling.off`), and in production **the api refuses to start**
(`twilio_incomplete`) - a half-set configuration looks fine and fails every call
(`TWILIO-SETUP.md`, "Settings", owns that behaviour). Where each comes from in the
Twilio Console is in `.env.example`.

## Set by the compose files only

| Variable | Service | Value |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `postgres`, local only - on the server the service is hidden (`profiles: ["dev-only"]`) and RDS is used | `app`, `app`, `leads` |

## How to add an entry

1. Read it in code - `config.ts` for a required one, its own pure settings file for
   a group like Twilio's - and decide whether a missing or malformed value stops the
   start or switches a feature off.
2. Pass it to each container that reads it in `docker-compose.yml`, and in
   `docker-compose.prod.yml` if the server sets it differently; add it to
   `.env.example` with a comment saying what it is and where it comes from.
3. In the same commit, its row here and a History line. A secret is never written
   into any committed file.

## History

- 2026-11-27 · Written, the one owner of the environment variables - from `docs/README.md`'s environment table, `config.ts`, `twilio-settings.ts`, `auto-calls-settings.ts`, the compose files and `.env.example`; one row per variable · D06
- 2026-11-24 · `OPENAI_API_KEY` set on the server; Seri's switch on Admin > Configuration as well as the command
- 2026-11-23 · `OPENAI_BASE_URL` written down, for tests only and not passed to the containers (review R5); `AUTO_CALLS` said to be on in production since 2026-10-30 (review R5); `EZT_SEND_GROUP` called the switch it is - its value is never used, and its refusal message had said otherwise (review Q12); `CADDY_DOMAIN`, unused, removed (review Q9)
- 2026-11-22 · Local postgres, redis and the api listen on `127.0.0.1` only; the local `JWT_SECRET` still falls back to `dev-secret` · review M35
- 2026-11-11 · `OPENAI_API_KEY` · A01
- 2026-10-30 · `AUTO_CALLS=on` in production
- 2026-10-24 · `AUTO_CALLS` and `AUTO_CALL_TEST_NUMBERS` passed to the worker too, which places the calls · T20
- 2026-10-18 · `AUTO_CALLS` (T10) and `AUTO_CALL_TEST_NUMBERS` (T12)
- 2026-10-16 · `TWILIO_IDENTITY_PREFIX`, and a dev number and TwiML App of the laptop's own; before, the only number was production's, so a local `.env` kept its Twilio lines empty
- 2026-10-02 · `TWILIO_TRANSCRIPTION_SERVICE_SID`
- 2026-10-01 · The seven Twilio settings · Phase 4
- 2026-09-29 · `EZT_WEBHOOK_TOKEN` required in production (Jeel) - until then `.env.example` only asked for it
- 2026-09-28 · `REDIS_URL` out of the required list: nothing reads it, and a required setting nothing reads only stops the app starting
- 2026-09-15 · Sending live: with `EZT_SEND_GROUP` set, the poller sends the first question as it takes a lead in. Until then `EZT_SEND_GROUP` was to stay unset - the account was taken for the client's live account, where sending was allowed only to a `dev-test` group of our own phones, and none existed - so the poller took leads in and sent nothing, deliberately
- 2026-09-14 · The account is a test account (Jeel): `EZT_GROUP=weightloss`, `EZT_SOURCE=WebInterface`, `EZT_SEND_GROUP=weightloss` locally; `EZT_SOURCE` configurable, default `API`
