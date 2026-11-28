# Testing it

Every way the app is tested, and the command for each: unit and route tests,
lint and type checks, the live checks against a real Postgres, the speed check,
the end-to-end script, Seri's test sets against OpenAI, walking a flow with one
phone, and the docs check. What each area's tests prove is in its own doc's
Tests table; this is how to run them. Running the app is `RUNNING.md`.

## Before you start

- The app runs locally (`RUNNING.md`): the live checks, the speed check and the
  end-to-end script need this project's `postgres` container up.
- The unit tests need nothing running: they mock the database.
- Seri's test sets and replays need `OPENAI_API_KEY` in the shell, and cost
  OpenAI calls: they are run by hand, never in CI.
- Before a PR, the checks in `WORKFLOW.md`, "Before opening a PR".

## Unit and route tests, lint, types

```bash
cd backend
npm test                     # Jest - unit and route tests; the database mocked
npm run lint                 # ESLint, src and scripts
npx tsc --noEmit             # the app's types
npm run typecheck:scripts    # scripts/ and the tests, with the app
```

```bash
cd frontend
npm test                     # Vitest with jsdom and Testing Library, once
npm run test:watch           # the same, watching
npm run lint                 # ESLint, with the React hooks rules
npm run build                # tsc then vite build - also what catches a type error in a test
```

The unit and route tests cover behaviour in isolation. The frontend's tests cover
logic first: a screen is easy to judge by eye, a dropped response or an off-by-one
is not. `vite.config.ts` lets Vitest load the stylesheets under `src/styles` for
real, which the type-system test needs (`FRONTEND-STYLE.md`, "What the type-system
test enforces").

## Live checks

A mocked pool says nothing about aggregates, date windows, transactions or races,
so the SQL is proved against a real Postgres by the live checks,
`backend/scripts/*-live-check.ts`. Run them each on its own freshly migrated
scratch database:

```bash
cd backend
scripts/live-checks.sh              # all of them
scripts/live-checks.sh flows queue  # just these - the names without -live-check
```

- It uses this project's own postgres (`docker compose ps -q postgres`), the one on
  `localhost:5433`, and never touches the `leads` database.
- A migration that fails stops that check with the migration's own error.
- It prints one line per check, with how many passed and its verdict, and exits 1
  if any failed.
- Each check refuses to run against a database that holds leads (the presence
  check: users). Its header comment gives the command to run it by hand.
- Every check uses the one `check()` in `backend/scripts/check.ts`, which compares
  values whatever the order of their keys and prints the verdict the runner reads;
  `backend/scripts/live-flow.ts` puts a check's lead somewhere in a flow through
  the real reply path, so it has the rows a real lead has. Nothing is sent.

Which check proves what is in each area doc's Tests table.

## The speed check

How fast every screen's read is with a lot of leads: it loads 50,000 fake leads
into an empty scratch database and times the function behind each screen, and the
reply path (`backend/scripts/speed-check.ts`; `QUEUE.md`, "How fast it is"). The
numbers depend on the machine: compare runs on the same one, before and after a
change.

```bash
docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE speed'
cd backend
DATABASE_URL=postgres://app:app@localhost:5433/speed node scripts/migrate.js
DATABASE_URL=postgres://app:app@localhost:5433/speed JWT_SECRET=x EZT_USERNAME=x \
  EZT_PASSWORD=x EZT_GROUP=weightloss EZT_SEND_GROUP=weightloss npm run speed -- 50000
```

## The end-to-end script

The whole system in one run (`backend/scripts/end-to-end.ts`): a lead arrives,
answers the active flow's questions through the real webhook, is scored, reaches
the queue, is claimed, worked, closed, and finally blocked. Then, with automated
calls on, the robot calls leads who never replied, one at a time as one agent is
free - its database's five calls at once for each person free set to one: a "yes"
the agent takes, a "yes" nobody takes - first in the queue - and a "no", then yes
to the link, which is texted; that lead's "thanks" afterwards goes to a person
(`STATE-MACHINE.md`, rule 2d). Then Seri is switched on: the robot
places nothing while OpenAI does not answer its check, then she takes calls
through her real relay - a call back booked, a transfer taken, the link, a stop
blocked without OpenAI being asked, and OpenAI failing mid-call with the script
taking over - and the api restarting mid-call, the call picked back up.

```bash
docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE e2e'
docker compose cp backend/scripts/end-to-end.ts api:/app/scripts/
docker compose exec -e DATABASE_URL=postgres://app:app@postgres:5432/e2e api node scripts/migrate.js
docker compose exec -e DATABASE_URL=postgres://app:app@postgres:5432/e2e -e EZT_SEND_GROUP=stub api npm run e2e
```

The api container must be on the current image - `docker compose up -d --no-deps
api` after a build - or it lacks newer packages. The script writes rows, so it
refuses a database that holds any; it sets that database's calling hours to every
hour of every day, so it passes whenever it is run. Its header gives the same run
from the laptop's shell.

**What it proves, and what not.** EZ Texting and Twilio are stubbed at their HTTP
boundaries - `axios.post`, and the Twilio library's one request method, which
answers only "place this call" and fails the run on anything else - and OpenAI is
a local server that `OPENAI_BASE_URL` points at, answering Seri's brain with the
acts and words each step scripts while the brain itself decides. Twilio's side of
each call is its webhooks, posted to the real routes and signed as Twilio signs
them, each at the address the previous answer gave; Seri's relay is the real
WebSocket on a real server. So it proves everything up to the moment a text, a
call or a question to the model would leave the building - and nothing about
whether a real phone buzzes or rings, or what the real model would say.

## Seri's test sets

Run by hand against OpenAI before every change to her knowledge files or her
brain's prompts (`AI-BRAIN.md`, "Tests", says what each checks):

```bash
cd backend
OPENAI_API_KEY=... npm run ai:eval:understand
OPENAI_API_KEY=... npm run ai:eval:speak
OPENAI_API_KEY=... npm run ai:replay -- --real turns.json --runs 10
```

`ai:replay` says whole real calls - a local export of `call_ai_turns`, never
committed - to the real brain, and exits 1 when a replay breaks a rule.

## Testing a flow with one phone

A real walk needs a real phone, and every path of a flow is several walks. The
poller skips a number it already holds (`POLLER.md`, "Not done"), so a second walk
would need a second phone or an emptied database. Instead, locally:

```bash
docker compose exec api npm run dev:ask-again -- +16025550123
```

It marks the lead's open conversation expired, if it has one, starts a new one in
the flow new leads get, and sends the first question the way the poller does.
Nothing is deleted: the earlier walks and their answers stay on the lead, and the
reset is a `dev.test_reset` row in the activity log.

- **Local only.** It refuses when `NODE_ENV` is `production` - and the server's
  image could not run it anyway: it holds only the compiled `dist/` and
  `scripts/migrate.js`, with no ts-node.
- **The lead must exist already** - the first walk comes in through the poller -
  and it refuses a blocked number: after a walk that ends with STOP, text START
  from the phone first.
- **The lead keeps its agent history.** A lead somebody holds, closed or left a
  note on still reads Working or Closed on Admin > Leads and in the queue,
  whatever the new walk does. For an untouched lead's tags and statuses, use a
  lead nobody has worked.
- **Replies reach a local api only through a tunnel** and its own EZ Texting
  subscription - `RUNNING.md`, "Receiving real replies locally". Delete the
  subscription afterwards.

## Real calls

A real call needs a real phone and the dev number: `TWILIO-SETUP.md`, "Testing
locally, on the dev number". The robot's call locally rings only
`AUTO_CALL_TEST_NUMBERS`, placed by `npm run dev:auto-call` (`AUTO-CALLS.md`,
"Trying it locally"). The real-phone checklists run so far are tickets: the
robot's, `auto-call-tickets/T26-real-phone-then-live.md`; Seri's,
`ai-agent-tickets/A34-a21-walked-again.md`.

## The docs check

```bash
cd backend
npm run docs:check                          # every doc
npm run docs:check -- --strict              # also: every doc in the index
node ../scripts/docs-check.mjs --self-test  # each rule catching its fault
```

What it checks is `DOCS.md`, "Checking a doc".

## When it goes wrong

| What you see | What it means | What to do |
|---|---|---|
| A live check prints `Refusing to run` | The database it was given holds leads (or users) | Run it through `scripts/live-checks.sh`, which makes a scratch database |
| `postgres is not running` from `live-checks.sh` | This project's postgres container is down | `docker compose up -d postgres` |
| `MIGRATION FAILED` beside a check | A migration does not apply to an empty database | Its own error is printed under the line; fix the migration |
| `npm run e2e` fails on a missing package | The api container runs an older image | `docker compose build api`, then `docker compose up -d --no-deps api` |
| `ts-node: not found` | A dev script run in the server's production image | Dev scripts run only locally |
| A test set or replay throws `OPENAI_API_KEY is not set` | The key is not in the shell | `OPENAI_API_KEY=... npm run ...` |

## History

- 2026-11-27 · Written from `docs/README.md`'s "How to test", `FRONTEND.md`'s test commands and `FLOWS.md`'s "Testing a flow with one phone"; the counts of tests and checks dropped, as they drift; the claim that the server's image holds `scripts/` corrected - since review H13 it holds only `dist/`, `scripts/migrate.js` and the migrations · D06, D14, D29
- 2026-11-23 · One `check()` for every live check and the end-to-end script, keys put in order before comparing, so a check no longer passes or fails on the order a query gave them · review Q9
- 2026-11-22 · `live-checks.sh` uses this project's own postgres, and a migration that fails stops its check with its own error · review M37; `npm run typecheck:scripts` added; `ai:replay` exits 1 when a replay breaks a rule; the end-to-end script at 142 checks - 131 on 2026-11-12, 97 before Seri - beside twenty-three live checks
- 2026-11-19 · The answer test set of the first brain, `npm run ai:eval`, removed with it; `npm run e2e` runs the new brain · A34
- 2026-11-17 · `ai:eval:understand`, `ai:eval:speak` and `ai:replay` · A28, A29, A32
- 2026-11-12 · The end-to-end script runs Seri's calls through her real relay, OpenAI a local server · A20
- 2026-10-25 · The end-to-end script runs the robot's calls, Twilio stubbed at its HTTP boundary and its webhooks signed · T25
- 2026-10-06 · The speed check, 50,000 leads · flows
- 2026-09-28 · The end-to-end script and ESLint · Phase 3 tasks 28, 29
