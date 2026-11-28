# The docs

Every doc in the repo: its type (`DOCS.md`, "The types of doc"), what it owns - the
one place each fact lives - and when to update it. A change to what the app does
updates the doc that owns it in the same commit; another doc links to it and never
restates it. New to the app: `LEAD-FLOW.md`, then `ARCHITECTURE.md`.

## The docs

| Doc | Type | Owns | Update it when |
|---|---|---|---|
| **The map** | | | |
| [`CLAUDE.md`](../CLAUDE.md) | map | The rules for working in the repo, read at the start of every Claude session, and which doc to read before touching each part | A rule changes, or a doc is added that a session should read first |
| [`README.md`](../README.md) (the root) | map | One screen pointing into `docs/` | A doc it links is renamed |
| [`README.md`](README.md) | map | This index | A doc is added, renamed, split or changes type |
| [`LEAD-FLOW.md`](LEAD-FLOW.md) | map | A lead's whole life on one page - start here: every status drawn, each linked to the doc that owns it | A status, a tag or a way back into the queue is added or renamed - beside the doc that owns it |
| **How it is built** | | | |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | architecture | The parts - Caddy, the api, the worker, Redis, Postgres, the frontend - how they connect, the outside services, where the code is, and why it is built this way | A part, an outside service or a top-level folder is added or changes, or an architectural decision |
| **Steps to follow** | | | |
| [`RUNNING.md`](RUNNING.md) | how-to | Running it on a laptop: starting and stopping, sending texts, the EZ Texting subscription, real replies through a tunnel, posting a reply by hand, the local faults | A local step, a dev command or a local fault changes |
| [`TESTING.md`](TESTING.md) | how-to | Every test command: unit and route tests, lint, types, the live checks, the speed check, the end-to-end script, Seri's test sets, walking a flow with one phone, the docs check | A kind of test is added, or its command changes |
| [`WORKFLOW.md`](WORKFLOW.md) | how-to | Branches, commits, the checks before a PR, the definition of done, who holds which credentials, migrations and where the files stand | The process changes, or a migration reaches `main` |
| [`DEPLOY.md`](DEPLOY.md) | how-to | The server: deploying, the images, the first account, what stops the api starting, `twilio:configure`, the robot's and Seri's switches, the resend after an outage, the logs in CloudWatch, connecting to RDS, the server's faults | A deploy step, a production command, a switch or a server fault changes |
| [`TWILIO-SETUP.md`](TWILIO-SETUP.md) | how-to | What the Twilio account needs, calling's settings and their three states, `twilio:configure` and its guard, the never-from-a-laptop rule for production's number, testing on the dev number, deploying calling | The Twilio account, `twilio:configure`, or a calling setting changes |
| **The parts of the app** | | | |
| [`AUTH.md`](AUTH.md) | area | Sign-in, sessions, roles, the first account, Admin > Agents | Auth routes, guards or the `users` table |
| [`POLLER.md`](POLLER.md) | area | The worker's cycle: pulling leads in from EZ Texting, the first question, who is never texted, the opener retry, the resend's rules | The poller or the worker loop |
| [`WEBHOOKS.md`](WEBHOOKS.md) | area | The EZ Texting webhook: dedupe, the path token, the opt-out and opt-in words, numbers we hold no lead for, the reply handed to the flow | The webhook handler |
| [`STATE-MACHINE.md`](STATE-MACHINE.md) | area | The SMS flow: what a reply does (rules 1-4, 2b-2d), scoring and tiers, expiry, sending, the missed-call text, opting back in, a number that comes back. Overrides the mockup | The state machine, or any flow decision |
| [`FLOWS.md`](FLOWS.md) | area | How the SMS scripts are stored as rows - flows, questions, choices, answers - the antibiotics flow, naming a question, adding or changing a flow | A new or changed flow, or how answers are stored |
| [`QUEUE.md`](QUEUE.md) | area | The agents' priority queue: who is in it, the order, the tag - `GET /api/leads` | The queue query, the order or the tag rules |
| [`AGENT-WORKSPACE.md`](AGENT-WORKSPACE.md) | area | The agent's lead page: claim and release, the write guard, the lead card, marking read, notes, outcomes, the DNC block every path shares, agent SMS | Any of those endpoints, `db/dnc.ts`, or the workspace screen |
| [`CALLBACKS.md`](CALLBACKS.md) | area | Callbacks - an agent's, a missed call's, Seri's - My Callbacks and its windows, and who takes a call back nobody has | `db/callbacks.ts`, `api/callbacks.ts`, My Callbacks, or the pick-up rule in `claimLead` |
| [`TIMELINE.md`](TIMELINE.md) | area | The lead timeline: its sources, system events, order and wording | `db/timeline.ts`, `components/Timeline.tsx`, or anything new that should show on a lead's history |
| [`ADMIN-LEADS.md`](ADMIN-LEADS.md) | area | Admin > Leads: every status and what reopens a closed lead, Step, the Call column, the page | A status, `STATUS_SQL`, `CLOSED_SQL` or `WORKED_SQL`, that page or its API |
| [`ADMIN.md`](ADMIN.md) | area | Admin Overview, Configuration and the DNC list; why admin is read-only, and its one control, Seri's switch | An admin screen other than Leads or Agents |
| [`TWILIO.md`](TWILIO.md) | area | Calls an agent places from the browser: the token, the voice and status webhooks, the call bar, voicemail detection, recordings, transcripts and the recording notice, why Twilio's webhooks can be trusted, calls whose end never came | Anything about calls we place, Twilio's webhooks, the Call button or the call bar |
| [`INCOMING-CALLS.md`](INCOMING-CALLS.md) | area | A lead calling our number: who rings, a ring to everyone free, a missed call - its text, tag and callback, and what settles it - the incoming-call card, rings to several people, the ringtone, the desktop notification | Anything about a lead calling in, the incoming-call card, the ringtone or a missed call |
| [`AUTO-CALLS.md`](AUTO-CALLS.md) | area | Phase 6's design and hub - the robot's call: who is called and when, how many at once, Twilio refusing, how a call is placed, its webhooks, what is saved and where it shows | Who the robot calls, its hours or pace, placing a call, a webhook |
| [`AUTO-CALL-SCRIPT.md`](AUTO-CALL-SCRIPT.md) | area | The robot's script, how a spoken or keyed answer is read, when the call listens, what follows each answer, voicemail | The script's rows, answer matching, listening, the voicemail rule |
| [`AUTO-CALL-TRANSFER.md`](AUTO-CALL-TRANSFER.md) | area | Who is free, the "Taking calls" switch, the transfer, the hold line, the ring to the next person free, a lead calling back | Who is rung, the switch, the transfer, the hold line |
| [`AI-AGENT.md`](AI-AGENT.md) | area | Phase 7's design, with its Status line - the call around Seri: who takes an answered call, the relay, how a reply is made around her brain, voicemail while she talks, the line dropping, who is there, her five actions and `/auto/ai-after`, the call-back time rules, the limits and the fallback, the check before calling, her switch and key | Anything about a call she takes, her actions, her switch, or what happens when she fails |
| [`AI-BRAIN.md`](AI-BRAIN.md) | area | Her brain: understand, decide, speak - the policy's rules, the record of each reply, the two models and how fast they are, the understand and speak test sets and the replays | `ai/brain.ts`, `understand.ts`, `policy.ts`, `speak.ts`, `model.ts` or a prompt changes |
| [`BUCKETS.md`](BUCKETS.md) | area | Phase 8's design, with its Status line: several buckets - campaigns - at once, uploaded lists for reminder calls, the setup screens | Any decision or ticket about buckets, uploaded lists or the setup screens |
| [`FRONTEND.md`](FRONTEND.md) | area | The React app as built: the stack, the screens and routes, the app shell, the polling hook, the one-agent lock on screen, the types it shares with the backend, building and serving, where it differs from the brief | A frontend change that is not one area's screen |
| **Tables to look things up in** | | | |
| [`SCHEMA.md`](SCHEMA.md) | reference | Every table, column, constraint and index, and the `settings` rows | A migration |
| [`AUDIT.md`](AUDIT.md) | reference | The activity log's actions, the add-only rule, the raw webhook archive, what the log does not cover | **Any new action a person or the system can take** - it records itself, or this doc says why not |
| [`LOGGING.md`](LOGGING.md) | reference | The log line, redaction, every log event, the health endpoints | Anything logged, or the health routes |
| [`EZTEXTING-API.md`](EZTEXTING-API.md) | reference | EZ Texting's API as verified - endpoints, filters, fields, the webhook, every finding with its evidence - and the account's rules: a test account, the group filter, the permanent subscriptions | Something new is learned about the API or the account |
| [`ENVIRONMENT.md`](ENVIRONMENT.md) | reference | Every environment variable: what it is, whether it is required, what reads it, where it is set | A variable is added, removed or changes meaning, or the compose files pass it differently |
| [`AI-RELAY.md`](AI-RELAY.md) | reference | What Twilio and Seri's relay say: `RELAY_SETTINGS`, her TwiML, every message each side sends, how a session ends, her tones, the notes kept as turns, the timings measured on the dev number | A ConversationRelay setting, a message, a tone or a turn note changes |
| [`AI-KNOWLEDGE.md`](AI-KNOWLEDGE.md) | reference | What Seri knows: the three knowledge files, which parts a call reads, the rules they keep, every version, the edrugstore.com crawl | A knowledge file or its loader changes |
| [`FRONTEND-STYLE.md`](FRONTEND-STYLE.md) | reference | The frontend's design system: the type scale, the colour, space and layout tokens, what the type-system test enforces, the shared class names and components, the status icons | A token, a shared class or component, or a status icon |
| **The phases' tickets** | | | |
| [`auto-call-tickets/`](auto-call-tickets/README.md) | phase tickets | Phase 6's tracker and its tickets, T0 to T29 with T13b and T15a-T15c | A ticket's record is corrected |
| [`ai-agent-tickets/`](ai-agent-tickets/README.md) | phase tickets | Phase 7's tracker and its tickets, A01 to A34 | A Phase 7 ticket is built or changes state - its row in the same merge |
| [`bucket-tickets/`](bucket-tickets/README.md) | phase tickets | Phase 8's tracker and its tickets, B01 to B49 | A Phase 8 ticket is built or changes state - its row in the same merge |
| [`doc-tickets/`](doc-tickets/README.md) | phase tickets | Bringing every doc to the standard, D01 to D48 | A D-ticket is done |
| **Reviews** | | | |
| [`REVIEW-2026-11-22.md`](REVIEW-2026-11-22.md) | review | The whole repo read against its docs, 2026-11-22: every finding and whether it is fixed | A fix of one of its findings - its status, in the same commit |
| **The brief** | | | |
| [`ORIGINAL-PLAN.md`](ORIGINAL-PLAN.md) | brief | The plan the app was first built from: what to build, the stack and layout first planned, the four weeks and their "done when", the Phase 3 task list, the progress and phases tables as they were | Never - kept as it was |
| [`DESIGN-PROMPT.md`](DESIGN-PROMPT.md) | brief | The original frontend design brief | Never - kept as it was; what was built is `FRONTEND.md` |
| [`Secure-Medical-Call-Center-Mockup.pdf`](Secure-Medical-Call-Center-Mockup.pdf) | brief | Every screen as first drawn. Page 3 sketches the flow, but `STATE-MACHINE.md` is the authority for it | Never |
| **The standard** | | | |
| [`DOCS.md`](DOCS.md) | standard | How every doc is written: the rules, the types of doc and their sections, planning a phase, the fixed words, the phases and their letters | The standard itself, or a new phase - its row in "The phases" |
| [`templates/`](templates/) | standard | The skeletons a new doc or ticket starts from: `AREA.md`, `REFERENCE.md`, `HOWTO.md`, `TRACKER.md`, `TICKET.md` | A type's sections change in `DOCS.md` |

## History

- 2026-11-27 · Made the index and nothing else: one row per doc with its type, what it owns and when to update it. Moved out: the quick start, "Sending" and troubleshooting to `RUNNING.md`; "How to test" to `TESTING.md`; the environment table to `ENVIRONMENT.md`; "Architecture" to `ARCHITECTURE.md`; each known limit to its owner's Not done - Seri's state to `AI-AGENT.md`'s Status line, calling to `TWILIO.md`, `INCOMING-CALLS.md` and `TWILIO-SETUP.md`, the antibiotics flow's drafted lines and one flow for everyone to `FLOWS.md`, the queue's speed to `QUEUE.md`, a reply just after our text and a text that timed out to `STATE-MACHINE.md`, a returning lead and a first question a day late to `POLLER.md`, the deep health endpoint to `LOGGING.md`, polling to `FRONTEND.md`, Redis to `ARCHITECTURE.md`, State and Consent ref to `AGENT-WORKSPACE.md` and `FRONTEND.md`. Fixed on the way: test counts (they drift - dropped), "unverified" repeat leads (settled 2026-11-27, `EZTEXTING-API.md`), `EZT_SEND_GROUP` told both unset and set, a deployment doc "still to write" (it is `DEPLOY.md`) · D06
- 2026-11-24 · Seri deployed, her switch off · A22
- 2026-10-01 to 2026-11-23 · Known limits added as each part was built - calling, calling off locally until a tunnel is set, the antibiotics script and its lines waiting for the client's word (when nothing had yet been sent to anyone outside the test group), the queue's speed, a reply just after our text, a text that timed out, Seri built and then deployed
- 2026-11-22 · Local ports on `127.0.0.1` only; `live-checks.sh` on this project's own postgres · review M35, M37
- 2026-09-28 · How to test, the environment, known limits and the table of docs · Phase 3 task 30
- 2026-09-14 · Written: how to run it
