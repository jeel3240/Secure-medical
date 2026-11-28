# Running it locally

Use this to run the whole app on a laptop with fake data - the database, the api,
the worker and the frontend - to text your own phone through the EZ Texting test
account, and to receive its real replies through a tunnel. Testing is
`TESTING.md`; calling on a laptop is `TWILIO-SETUP.md`; the server is `DEPLOY.md`.

## Before you start

- **Docker** - Docker Desktop or Colima - **Node 20** and **Git**. A tunnel -
  ngrok, a free account - only for real replies or real calls.
- **The EZ Texting test account's credentials, from Jeel.** It is a test account,
  and its `weightloss` group is the test group (`EZTEXTING-API.md`, "The
  account"). Do not touch production's settings.
- **No real lead data, ever.** Generate fake leads, or use your own phone in the
  test group.
- **A local `.env` never holds production's Twilio number, (480) 470-8259**
  (`TWILIO-SETUP.md`, "Before you start"). Locally the Twilio lines stay empty, or
  hold the dev number.
- Every variable is in `ENVIRONMENT.md`.

## Start it

1. Install the dependencies:

   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   cd ..
   ```

2. Configure: `cp .env.example .env`, then fill in the `EZT_*` values. Leave the
   Twilio lines empty: calling is off until all seven are set.
3. Start the services. Locally that is postgres, redis, the api and the worker -
   no caddy. Their ports, 5433, 6379 and 3000, are open on the laptop only
   (`127.0.0.1`), not to its network.

   ```bash
   docker compose up -d
   ```

4. Create the schema:

   ```bash
   docker compose exec api npm run migrate
   ```

5. Create the first superadmin. Nobody can sign in to create an account until one
   exists (`AUTH.md`, "The first account"). It prints a temporary password once;
   signing in with it, you are made to set your own before anything else works.

   ```bash
   docker compose exec api npm run dev:create-superadmin -- you@example.com "Your Name"
   ```

6. Watch the poller. The worker logs a JSON line on every poll, every 30 seconds
   (`LOGGING.md` lists every event); `inserted` is new leads:

   ```bash
   docker compose logs -f worker
   ```

   ```
   {"ts":"2026-09-28T23:50:24.426Z","level":"info","event":"poll.tick","svc":"worker","fetched":2,"inserted":0,"skipped":2,"suppressed":0,"openers":0,"ms":336}
   ```

7. In a second terminal, start the frontend, then open http://localhost:5173:

   ```bash
   cd frontend && npm run dev
   ```

   Vite serves the app on :5173 and forwards `/api` to the api on
   `127.0.0.1:3000`, so the session cookie works as it does behind Caddy
   (`FRONTEND.md`, "Building and serving"). `npm run build` - `tsc`, then
   `vite build`, into `dist/` - is what the server's image runs.

**To look at the data:**

```bash
docker compose exec postgres psql -U app -d leads \
  -c "SELECT phone, first_name, source, ezt_added_at FROM leads ORDER BY ezt_added_at DESC;"
```

Or DBeaver or TablePlus: `localhost:5433`, user `app`, password `app`, database
`leads`.

## Stopping for the day

`docker compose stop` keeps all the data; stop the frontend with Ctrl+C. On
Colima, `colima stop` frees the VM's memory. Next time: `colima start`,
`docker compose up -d`, `cd frontend && npm run dev`. `docker compose down -v`
wipes the database.

## Sending texts locally

With `EZT_SEND_GROUP` unset, `sendMessage` refuses every send, so the poller takes
leads in and texts nobody - deliberately (`ENVIRONMENT.md`, `EZT_SEND_GROUP`). To
text your own phone:

1. In the EZ Texting dashboard, add your phone as a new contact in the
   `weightloss` group. Contacts added by hand arrive with source `WebInterface`.
2. In `.env`, set `EZT_GROUP=weightloss`, `EZT_SOURCE=WebInterface` and
   `EZT_SEND_GROUP=weightloss`.
3. Recreate the two containers, so they read the new values:

   ```bash
   docker compose up -d worker api
   ```

Within a poll interval the contact is a lead and gets the first question;
`openers` in the `poll.tick` line counts them (`POLLER.md`). Every send is checked
again against `dnc_list` just before it goes. The poller skips a phone it already
holds, and a contact that shows up more than 5 minutes after it was created is
never taken in (`POLLER.md`, "Not done"); to walk the questions again with the
same phone, `TESTING.md`, "Testing a flow with one phone".

## Registering the subscription

EZ Texting posts replies to the webhook subscriptions registered on the account.
There is no settings page for them: they are API-only (`EZTEXTING-API.md`,
"Endpoints"):

```bash
POST https://a.eztexting.com/v1/webhooks/subscriptions
{ "type": "inbound_text.received",
  "callbackUrl": "https://<host>/api/webhooks/eztexting/<token>",
  "secret": "<token>" }
```

`GET` on the same path lists them; `DELETE /v1/webhooks/subscriptions/{id}`
removes one. `<token>` is `EZT_WEBHOOK_TOKEN` (`WEBHOOKS.md`, "The path token").
Several subscriptions of this type can coexist. **Two are permanent and must
stay** - the client's Zapier one and production's (`EZTEXTING-API.md`, "The
account"). Never delete them.

## Receiving real replies locally

A real text needs a public address:

1. Run a tunnel to the api: `ngrok http 3000`.
2. Register its address as a subscription ("Registering the subscription").
   The tunnel's address changes each time it restarts, so this is done each
   session.
3. Text the lead's question back from your phone; the reply reaches the local
   api.
4. **Delete the subscription when you stop.** It covers the whole account and
   outlives the tunnel it points at (`EZTEXTING-API.md`, "Subscriptions", says
   what goes wrong if it is left behind):

   ```bash
   # list, then delete by id when finished
   curl -s -u "$EZT_USERNAME:$EZT_PASSWORD" https://a.eztexting.com/v1/webhooks/subscriptions
   curl -X DELETE -u "$EZT_USERNAME:$EZT_PASSWORD" \
     https://a.eztexting.com/v1/webhooks/subscriptions/<id>
   ```

## Posting a reply by hand

No tunnel needed: post what EZ Texting would. With `EZT_WEBHOOK_TOKEN` unset
locally, the plain path works too.

```bash
curl -X POST http://localhost:3000/api/webhooks/eztexting/$EZT_WEBHOOK_TOKEN \
  -H 'Content-Type: application/json' \
  -d '{"id":"309112289003","type":"inbound_text.received",
       "fromNumber":"16025550147","toNumber":"15205550109",
       "message":"3","received":"2026-09-14T17:06:31.042+00:00",
       "optIn":false,"optOut":false}'
```

Posting it twice stores one row. Changing `received` but not `id` - a lead
correcting their answer - stores two. A number we hold no lead for is ignored
(`WEBHOOKS.md`, "Replies from numbers we hold no lead for"), so use a lead's phone.

## Calls locally

Calling is off locally until a tunnel is set for a test: the dev number,
(480) 530-8582, its own TwiML App and `TWILIO_IDENTITY_PREFIX=dev-` -
`TWILIO-SETUP.md`, "Testing locally, on the dev number". The robot's calls ring
only `AUTO_CALL_TEST_NUMBERS` (`AUTO-CALLS.md`, "Trying it locally"); Seri's
switch locally is `docker compose exec api npm run dev:ai-agent -- on`
(`DEPLOY.md`, "Seri, the AI agent").

## When it goes wrong

| What you see | What it means | What to do |
|---|---|---|
| The worker exits as soon as it starts | A required variable is missing - the message names it. `EZT_GROUP` is easy to forget | Set it in `.env` (`ENVIRONMENT.md`), then `docker compose up -d` |
| `npm error Missing script` | The container runs a stale image | `docker compose build worker api`, then `docker compose up -d` |
| Sign-in fails with a server error after pulling | The local database was made before `users.session_version` and `users.last_login_at` were added to `001_init.sql` | Rebuild the database, or run the two `ALTER TABLE` lines in `SCHEMA.md`'s History (2026-09-14) |
| `/api` requests return the page's HTML on :5173 | The Vite dev server restarted without its config - `vite.config.ts` briefly disappeared, for example while switching branches | Stop it and run `npm run dev` again |
| Sign-in fails locally with nothing wrong in this app | Something else listens on port 3000 - another project's dev server on `[::1]:3000` once took every `/api` call. The proxy names `127.0.0.1` to avoid it (`frontend/vite.config.ts`) | See what holds the port: `lsof -nP -iTCP:3000 -sTCP:LISTEN` |
| Cannot connect to Postgres on `localhost:5433` | A native PostgreSQL service is bound to the same port and winning | Use `docker compose exec postgres psql`, or change the host port in `docker-compose.yml` |
| A contact added in EZ Texting never becomes a lead | Its source is not `EZT_SOURCE`, its phone is already a lead, or it showed up more than 5 minutes after it was created | Check `EZT_SOURCE=WebInterface` for a contact added by hand; `POLLER.md`, "Not done" |
| A new lead gets no first text | `EZT_SEND_GROUP` is unset | "Sending texts locally" |

## History

- 2026-11-27 · Written from `docs/README.md`'s quick start, "Sending" and troubleshooting, `CLAUDE.md` §7, and the how-to parts of `AUTH.md` (the first superadmin), `WEBHOOKS.md` (the subscription, real replies, posting by hand) and `FRONTEND.md` (the frontend's commands, port 3000) · D06, D13, D15, D29
- 2026-11-22 · The local postgres, redis and api ports opened on `127.0.0.1` only · review M35
- 2026-10-16 · A dev number of the laptop's own for calls; until then calling was not tested locally at all and the local `.env` kept its `TWILIO_*` lines empty (`TWILIO-SETUP.md`)
- 2026-10-11 · The dev proxy names `127.0.0.1`, not `localhost` · another project's server on `[::1]:3000` took every `/api` call
- 2026-09-15 · Sending live: with `EZT_SEND_GROUP` set, the poller sends the first question as it takes a lead in, and records it in `messages`
- 2026-09-14 · The account is a test account (Jeel), so sending may be unlocked with the `weightloss` group. Until then the account was taken for the client's live account, where sending was allowed only to a `dev-test` group of our own phones; no such group existed, so `sendMessage` threw unless `EZT_SEND_GROUP` was set, and the poller took leads in without sending - deliberately
- 2026-09-14 · The plan's local setup corrected: the local compose starts postgres, redis, the api and the worker - no caddy, the frontend on the Vite dev server; Postgres on host port 5433, not 5432; the first superadmin made after migrating; Colima works in place of Docker Desktop; nothing pasted into Twilio by hand - `dev:twilio:configure` points the TwiML App and the number
- 2026-09-10 · The plan's setup (`ORIGINAL-PLAN.md`): `docker compose up -d` with caddy, an ngrok address pasted into the EZ Texting sandbox and a Twilio test TwiML App, sandbox access from Jeel, tables on `localhost:5432`
