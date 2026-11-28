# Deploying and running the server

Use this on the server: deploying `main`, the images it builds, the first account,
pointing Twilio at it, the switches for the robot's calls and for Seri, resending
first texts after an outage, reading the logs, and what to do when something goes
wrong. Only Jeel deploys; a developer never touches EC2, RDS or the client's
accounts. Getting a change onto `main` is `WORKFLOW.md`.

## Before you start

- **What is deployed is `main`**, merged from `dev` by Jeel (`WORKFLOW.md`).
  Production runs whatever `main` holds; "Where the files stand" in `WORKFLOW.md`
  says which migrations it has.
- **Every production command names both compose files** - `docker compose -f
  docker-compose.yml -f docker-compose.prod.yml ...` - as written below.
  `docker-compose.prod.yml` is laid over the first: RDS in place of the local
  postgres, no ports open but Caddy's, the `production` image, the `awslogs` log
  driver, and the `caddy` service.
- **The server's `.env` holds the real credentials**, and no committed file does.
  Every variable is in `ENVIRONMENT.md`.
- **Deploy after 5 PM Arizona time**, when the robot is not calling: a call with
  Seri is picked back up across an api restart ("Deploying"), but Caddy itself
  restarting is untested.

## Deploying

Today's steps:

```bash
ssh <ec2>
cd /opt/secure-medical
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api npm run migrate
```

1. **Run `npm run migrate` straight after the `up`.** It applies, in order,
   whatever the database has not run. Until a migration has run, new code that
   reads its columns fails there - with 017 due, signing in and every page
   would, as the code reads `users.taking_calls`.
2. **Check `docker compose -f docker-compose.yml -f docker-compose.prod.yml ps`**
   after a deploy that changes the log settings: a missing CloudWatch permission
   stops a container starting ("Logs", below).
3. **Calling:** on the first deploy with calling, and whenever `PUBLIC_URL` or a
   Twilio setting changes, run `twilio:configure` last ("Pointing Twilio at the
   server").

The same `--build` rebuilds the frontend: the `caddy` service is built from
`frontend/Dockerfile`, which compiles the React app and copies it into the Caddy
image, so the server needs no Node install.

**A call with Seri during a deploy is picked back up.** As the api stops, it hands
her line back to Twilio; Caddy holds Twilio's reconnect until the new api is up -
a few seconds - and she goes on where she was (`AI-AGENT.md`, "When the line
drops").

**The Caddyfile reaches Caddy by itself.** It is `caddy/Caddyfile`, its folder
mounted and Caddy run with `--watch`, so a `git pull` that changes it is reloaded
within about ten seconds; a broken one is refused, logged by Caddy's `watcher`,
and the running config kept. A deploy that changes the `caddy` service's compose
settings recreates its container by itself - the site down a second or two.

### The order planned

B02 will change the order so the new code never runs against the old database -
not done yet; the steps above are what is true today:

1. `git pull`;
2. `docker compose -f docker-compose.yml -f docker-compose.prod.yml build api worker`;
3. `docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm api npm run migrate` -
   the new image, against the database, while the old containers still run;
4. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.

A migration that adds is invisible to the old code still running; one that drops
ships only in a deploy after the code stopped reading what it drops
(`bucket-tickets/B02-deploy-order-migrations-first.md`).

## The images

`backend/Dockerfile` has two stages:

- **`dev`** - every dependency (`npm ci`), the source, the scripts and the build.
  Local `docker compose` builds this stage (`target: dev`): the api and the worker
  run under ts-node with `src/` mounted, and `npm run dev:*`, `dev:auto-call` and
  the live checks work.
- **`production`** - what the server builds (`docker-compose.prod.yml`, `target:
  production`): the compiled `dist/` from the stage above, production dependencies
  only (`npm ci --omit=dev`), and what `npm run migrate` reads
  (`scripts/migrate.js`, `src/db/migrations/`), run as the unprivileged `node`
  user. No ts-node, no tests, no dev scripts: `npm run migrate`, `ai-agent`,
  `twilio:configure`, `openers:send-waiting` and `create-superadmin` run there;
  anything `dev:` cannot run there at all (`ts-node: not found`).

The api and the worker run compiled `dist/` - `npm run api` and `npm run worker` -
never ts-node.

## The first account

On the very first deploy, after migrating, create the first superadmin. It prints a
temporary password once; the first sign-in with it asks for a password of one's
own (`AUTH.md`, "The first account"):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api npm run create-superadmin -- you@example.com "Your Name"
```

(`dev:create-superadmin` is the laptop's, with ts-node - `RUNNING.md`.)

## What stops the api starting

The api refuses to start in production on any of three things, logging
`api.refused_start` with the `reason` (`api/startup-checks.ts`):

- `JWT_SECRET` a placeholder or shorter than 32 characters - generate one with
  `openssl rand -hex 32`;
- `EZT_WEBHOOK_TOKEN` missing or shorter than 16 - generate one with
  `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`;
- the seven Twilio settings only partly set - all or none (`ENVIRONMENT.md`).

And in any environment on a broken knowledge file of Seri's
(`ai_knowledge_invalid`, `api/index.ts`): the files are in the repo, so a broken
one is a bug, found on the first start (`AI-KNOWLEDGE.md`).

## Pointing Twilio at the server

On the first deploy that has calling, and whenever `PUBLIC_URL` or a Twilio
setting changes, run last - **only ever on the server**:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api npm run twilio:configure
```

It points the TwiML App and the phone number at this server, and refuses to move
either from something another server relies on unless `--take-over` is passed;
`-- --dry-run` shows what it would do. Run from a laptop with production's number,
it would move production's calls to that laptop. `TWILIO-SETUP.md`, "Pointing
Twilio at the server" and "Deploying it".

## Automated calls: switching the robot on and off

The variable is `AUTO_CALLS` (`ENVIRONMENT.md`). Calling must be set up first. On
the server every number may be rung: `AUTO_CALL_TEST_NUMBERS` is for laptops only.

**To switch it on:**

1. Add `AUTO_CALLS=on` to the server's `.env`.
2. Recreate the api and the worker - not `docker compose restart`, which keeps the
   old environment, so calls stay off:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api worker
   ```

3. Check Admin > Configuration > Calls: **On**, the call-back number production's
   (480) 470-8259, 11:00 AM - 5:00 PM, Monday to Friday. That screen shows the
   api's setting only; for the worker, its `worker.started` log line says
   `autoCalls` `on` (CloudWatch, stream `worker`).
4. Agents reload the app, then switch **Taking calls** on - the switch shows only
   on a page loaded after the switch-on. With nobody on, the robot calls nobody.
5. The first calls go out as soon as someone is free, inside the calling hours:
   the leads already waiting for a reply are due at once, oldest first; a lead
   that arrives after the switch-on is called an hour after its text, ahead of
   them (`AUTO-CALLS.md`, "Leads already waiting"). Watch them on the leads'
   timelines and Admin > Leads' Call column.

**To switch it off:** take `AUTO_CALLS` out of `.env` and run the same `up -d api
worker`, outside the calling hours - a call still going loses its webhooks (404)
the moment the api restarts without it.

The buckets' own switches come with Phase 8 (`BUCKETS.md`, "Switching a bucket
on").

## Seri, the AI agent

**Her key.** `OPENAI_API_KEY` goes in the server's `.env` before the `up -d
--build` that should use it, so the api and the worker are recreated with it.
Added later, recreate both - a `restart` keeps the old environment:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api worker
```

**Her switch** is `settings.ai_agent`, read on every call - no restart. A
superadmin switches it from the Seri card on Admin > Configuration's Calls tab, or
on the server:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api npm run ai-agent -- on
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api npm run ai-agent -- off
```

Locally it is `docker compose exec api npm run dev:ai-agent -- on`. `on` is
refused without `OPENAI_API_KEY`. Each change is recorded as `ai_agent.switched`
(`AUDIT.md`). Switched off, a call already with her finishes and the next one gets
the script (`AI-AGENT.md`, "Switches and rollout").

**Watching her first calls:** each lead's timeline shows her conversation under
the call (`TIMELINE.md`, "A call Seri took"); the logs are in CloudWatch -
`ai_relay.*`, `auto_call.ai_after`, `auto_call.dial` (`LOGGING.md`). The words are
only in `call_ai_turns`, never in the logs.

## Resending after an outage

After EZ Texting has been down for longer than the opener retry waits, the leads
that arrived meanwhile never get their first question by themselves (`POLLER.md`,
"Retrying a failed opener"). `npm run openers:send-waiting` sends it to them, by
hand, once a person has looked at the list - which leads, and how it sends, is
`POLLER.md`, "Resending after an outage".

Run it on the server, in the worker container, which has EZ Texting's credentials -
during the day, once EZ Texting is working again:

1. **See who would get one.** Sends nothing.

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec worker npm run openers:send-waiting -- --from 2026-10-14 --dry-run
   ```

2. **Send five, then check they arrived** - in EZ Texting, or on the leads'
   timelines.

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec worker npm run openers:send-waiting -- --from 2026-10-14 --limit 5
   ```

3. **Send the rest.** The five already sent are not listed again.

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec worker npm run openers:send-waiting -- --from 2026-10-14
   ```

The arguments (`core/resend-args.ts`): `--from` (required) and `--to` (now unless
given) - the window the leads arrived in; `--every`, seconds between texts (30 by
default, never under 10); `--limit`, stop after so many; `--dry-run`. A date or
time without an offset is **Arizona time** (`2026-10-14`, `2026-10-14T09:30`) -
Phoenix keeps one offset all year; one with `Z` or an offset is taken as written.
Locally, without a build, the command is `npm run dev:openers:send-waiting`.

What a dry run prints:

```
Leads that arrived Oct 14, 2026, 12:00 AM to Oct 16, 2026, 9:48 AM, Arizona time.

3 waiting for a first text, oldest first:
  #1 Priya ··0142  arrived Oct 14, 2026, 4:48 PM  5 failed attempts
  #2 Leo ··0188  arrived Oct 15, 2026, 3:48 AM  1 failed attempt
  #3 - ··0199  arrived Oct 15, 2026, 1:48 PM  5 failed attempts
Would send 3, one every 30 seconds - about 1 minute.
Dry run: nothing was sent.
```

It exits 0 when it finished or after a dry run, and 1 when the arguments were
wrong, another run was going, or it stopped at a text that did not go out - in
which case run the same command again to carry on. Ctrl+C is safe.

## Logs

**`docker compose logs` returns nothing on the server.** The production override
sets the `awslogs` log driver on the api, the worker and caddy, so their output
goes to CloudWatch: log group `/leads-app`, region `us-east-2`, one stream per
service - `api`, `worker` and `caddy`. Locally there is no override, so `docker
compose logs` works as usual: the same command behaves differently in the two
places - worth remembering before concluding a service is silent. What each line
says is `LOGGING.md`.

Two things about that driver, both in `docker-compose.prod.yml`:

- **A missing IAM permission stops containers starting,** rather than merely
  losing logs - Docker fails at container creation. The instance role needs
  `logs:CreateLogStream` and `logs:PutLogEvents`, plus `logs:CreateLogGroup`
  because `awslogs-create-group` is on.
- **Logs are shipped non-blocking,** because Docker's default blocking mode lets a
  slow log endpoint stall writes to stdout and with them the request handling.
  Under sustained pressure lines are dropped instead.

Retention is set on the log group itself, not in the repo - 30 days.

## The database

The database is RDS; backups are its own (`ARCHITECTURE.md`, "Outside
services"). Both `db/pool.ts` and `scripts/migrate.js` connect with `ssl: {
rejectUnauthorized: false }` when `NODE_ENV=production`, and with no SSL locally.
RDS certificates are signed by Amazon's CA, which Node does not trust by default;
a production `DATABASE_URL` carries `sslmode=require`, so without this the first
connection fails with `self signed certificate in certificate chain`. The
connection is still encrypted - only the issuer check is skipped, acceptable
because RDS is reachable only from inside the VPC. Point `ssl.ca` at the RDS CA
bundle if strict verification is ever wanted. `psql` does not hit this, as it does
not verify by default - so a working `psql` connection is not evidence that the app
will connect.

The app's connections also run with `jit=off` - Postgres's compile step cost more
than the queries it was applied to (`QUEUE.md`, "How fast it is") - and give up
waiting for a connection after ten seconds (`connectionTimeoutMillis`), so a
starved pool answers 500 and recovers rather than hanging until someone restarts
it. The database is only ever changed by a migration and by the app itself - never
by hand (`WORKFLOW.md`, "Migrations").

## When it goes wrong

Two ways the system goes quiet crash nothing, so whatever watches it alerts on the
absence of activity as well as on errors - the first two rows.

| What you see | What it means | What to do |
|---|---|---|
| No new leads; `poll.tick` still appears with `inserted` at 0, beside `level=error` lines | EZ Texting is rejecting us: the worker keeps ticking and the api answering, and leads simply stop arriving | Check the account and its credentials; once it works, "Resending after an outage" |
| No `poll.tick` at all from the worker | The worker died without its container stopping: nothing logs from that process. The last poll time is in the health report for this reason (`LOGGING.md`, "Health endpoint") | Recreate the worker: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d worker` |
| The api or the worker will not start after a deploy, and `docker compose logs` shows nothing | A missing CloudWatch permission - Docker fails at container creation | Give the instance role the three `logs:` permissions, or drop `awslogs-create-group` and create the group by hand |
| `api.refused_start` in the `api` stream | A production setting that would leave a hole - its `reason` says which ("What stops the api starting") | Set it in `.env`, then `up -d api worker` |
| Signing in and every page fail straight after a deploy | The new code reads a column a migration adds, and `npm run migrate` has not run | Run it |
| `self signed certificate in certificate chain` | The app connected to RDS without `NODE_ENV=production` | The compose override sets it; check the service runs with `docker-compose.prod.yml` |
| Calls stopped and `auto_call.webhooks_silent` in the worker's log | Twilio's reports are not reaching the api: `PUBLIC_URL` wrong, the api down, or `AUTO_CALLS` changed for the worker only | Recreate both containers with the same `.env` (`up -d api worker`); check `PUBLIC_URL` |
| `auto_call.twilio_refusing` | Twilio refused a call for our account's reasons - the key, the account, a limit; the robot pauses 15 minutes and tries one call again | Check the Twilio account; no lead's call is used up (`AUTO-CALLS.md`, "When Twilio refuses") |
| Admin says automated calls are On, and nothing is called | Nobody has Taking calls on, it is outside the hours, nobody is due, or the worker has them off | The worker's `worker.started` line; someone switched on; the hours on Admin > Configuration > Calls |
| Calling is Degraded on Admin > Overview, or leads who call ring nobody | The number or the TwiML App points elsewhere | `TWILIO-SETUP.md`, "When it goes wrong" |

## History

- 2026-11-27 · Written from `WORKFLOW.md`'s "Deploying" and "The images", `SCHEMA.md`'s "Connecting", `LOGGING.md`'s "The two ways this system goes quiet", `POLLER.md`'s resend steps, `AUTH.md`'s first superadmin, `AI-AGENT.md` section 7's commands and T26's going-live steps; every production command given with both `-f` files - `docker compose exec api npm run migrate` had been written without them · D08, D09, D11, D16, D13, D43, D34
- 2026-11-24 · Seri's code and migrations 022-024 deployed, her switch off; `OPENAI_API_KEY` set; her switch on Admin > Configuration as well as the command · A22, PR #31
- 2026-11-23 · The Caddyfile in `caddy/`, its folder mounted and watched: before, the file was mounted on its own, `git pull` replaced it, a running Caddy kept the old one, and Caddy had to be recreated by hand with `up -d --force-recreate caddy`. The reload and the refusal of a broken file were both seen on the `caddy:2` image locally · review Q11
- 2026-11-22 · Two image stages; before, the server's image carried every dev dependency, the tests and the dev scripts - guarded only by `NODE_ENV` - installed without the lockfile, and ran as root. Proved before the change: the production image migrated a scratch database (24 files), ran `ai-agent`, and started the api with `NODE_ENV=production` - health 200, Seri's knowledge loaded; a dev script in it refused; the local `dev` image as before · review H13
- 2026-11-13 · A call with Seri picked back up across a deploy; Caddy holds the reconnect · A21
- 2026-10-30 · Automated calls switched on in production, migrations 014-020 deployed with `AUTO_CALLS` unset and switched on after, as T26's steps say · T26
- 2026-10-16 · `openers:send-waiting`, the resend after an outage; run on production that day (`POLLER.md`, History) · T0
- 2026-10-05 · `twilio:configure` only ever on the server: production went live on (480) 470-8259 · Jeel
- 2026-09-14 · The deploy command takes the production override: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
