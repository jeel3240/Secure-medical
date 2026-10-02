# Logging and health

Phase 3. **Both are built**: the health endpoint (task 13, 2026-09-26) and
structured logging (task 26, 2026-09-28). Every line the api and worker write is
now one JSON object, queryable by field.

Shipping those lines off the instance *is* configured, in
`docker-compose.prod.yml`, and `WORKFLOW.md` says what that changes about reading
them - in short, `docker compose logs` works locally and not on the server. So
the lines below are already leaving the box; what the code still owes is their
shape.

## Structured logs

One JSON object per line on stdout, so whatever collects the logs can query by
field instead of matching substrings. Keep the existing lines' information;
change only the shape.

```json
{"ts":"2026-09-23T10:04:11.204Z","level":"info","event":"poll.tick",
 "fetched":2,"inserted":1,"skipped":1,"suppressed":0,"openers":1,"ms":336}
```

- `event` is a dotted name, and is the field everything is grouped by:
  `poll.tick`, `webhook.ignored`, `sms.sent`, `sms.failed`,
  `conversation.advanced`, `conversation.expired`. The full list is "Events in
  use", below. (This list first named three that were never built -
  `webhook.received`, `lead.created`, `auth.login_failed`; a failed sign-in is
  in the activity log, `AUDIT.md`, not here.)
- `level` is `info`, `warn` or `error`. An alarm on `level=error` is the
  cheapest useful alarm there is.
- Identifiers go in their own fields (`leadId`, `conversationId`) so a single
  lead's whole history can be pulled out of a day's logs.

**Never log a phone number, a message body, a name, a password, a token or the
EZ Texting credentials.** Logs leave the machine and are kept for months. A lead
id is enough to find the row; the row has the rest. This is the one rule in here
that is not a preference.

### As built - `src/lib/log.ts`

```ts
log.info('poll.tick', { fetched: 2, inserted: 1, ms: 336 });
log.error('sms.failed', { leadId, key, err: errText(err) });
```

`ts`, `level`, `event` and `svc` are added to every line; anything else is the
call site's. Undefined values are dropped, so optional fields do not fill each
line with nulls.

**`svc` is derived from the entry point,** not an env var - the worker always
knows it is the worker, and a `SERVICE_NAME` that must be set in every compose
file is one that will be missing from one of them. It was, on the first run:
every worker line said `svc: "api"`, which is the one thing the field exists to
prevent. `SERVICE_NAME` still wins when set.

**`warn` and `error` go to stderr,** `info` to stdout, because most collectors
alert on a container's stderr and `level=error` is meant to be the cheapest
useful alarm there is.

**`errText(err)` is how an error reaches a line.** It prefers an Axios
`response.data`, which is where EZ Texting puts the reason, and falls back to
the message. Never the stack - a stack can carry a message body inside an
interpolated string.

### Redaction is enforced, not trusted

`redact()` strips forbidden fields before anything is written, one level deep
into plain objects, and matches on suffixes too (`apiKey`, `accessToken`,
`leadPhone`). A forbidden field is replaced with `[redacted]` rather than
dropped: a field that vanishes is harder to debug than one obviously hidden.

This is enforced in code rather than left to call sites because **six lines in
`webhooks.ts` were logging raw phone numbers** before this task - into logs that
ship off the instance and are kept for months. Verified after the change by
firing a real webhook: the number appears nowhere in the output.

### Events in use

| Event | Where |
|---|---|
| `api.started`, `api.refused_start` | `api/index.ts`. `refused_start` carries `reason`: `weak_jwt_secret`, `no_webhook_token` or `twilio_incomplete` - the last with `missing`, the settings not set (`api/startup-checks.ts`) |
| `worker.started`, `poll.tick`, `poll.failed` | `worker/index.ts` |
| `conversation.expired`, `expiry.failed` | `worker/index.ts` |
| `call.token_issued`, `call.started`, `call.refused`, `call.failed_to_start`, `call.finished`, `call.answered_by`, `call.incoming`, `call.incoming_failed`, `call.missed_not_recorded`, `twilio.webhook_rejected`, `twilio.archive_failed`, `calling.off` | `api/calls.ts`, `api/twilio-webhooks.ts`, `api/index.ts` - browser calling, `TWILIO.md`. `call.refused` carries `reason`; `twilio.webhook_rejected` usually means `PUBLIC_URL` is not the address Twilio calls |
| `sms.sent`, `sms.failed`, `sms.no_template`, `sms.name_dropped`, `sms.record_failed` | `worker/poller.ts`, `worker/retry-openers.ts`, `worker/opener.ts` (`sms.name_dropped`), `api/reply-flow.ts`, `db/agent-sms.ts`, `db/outbound.ts` (`sms.record_failed`) |
| | The text after a missed call logs the same events with `key: message_missed_call` (`db/missed-call-text.ts`). Its `sms.failed` is at `warn`, a real refusal by EZ Texting included, so an alarm on `level=error` alone does not catch it |
| `opener.retry`, `opener.retry_failed`, `opener.gave_up` | `worker/retry-openers.ts` - `POLLER.md`, "Retrying a failed opener" |
| `webhook.rejected`, `webhook.ignored`, `webhook.failed` | `api/webhooks.ts` |
| `conversation.advanced` | `api/webhooks.ts` |
| `dnc.blocked`, `dnc.released` | `api/webhooks.ts` |
| `http.unhandled` | `api/http.ts` |
| `opener.retry`, `opener.retry_failed` | `worker/index.ts` - one line per pass that had something due, with `due`, `sent`, `failed`, `abandoned`, `tooOld` |
| `opener.gave_up` | `worker/retry-openers.ts` - once, at the failed attempt that reaches the limit. A warning: that lead will never get its first question |

A new event belongs in this table as well as in the code, or whoever is querying
the logs will never know to look for it.

### What is deliberately not structured

`src/cli/create-superadmin.ts`, `src/cli/twilio-configure.ts`,
`scripts/migrate.js` and `src/config.ts` still use `console`. The CLI
prints a one-time password to a human's terminal - that must never become a
shipped JSON log line - and `config.ts` runs before anything else exists, to say
which env var is missing.

## Health endpoint

`GET /api/health` exists and answers `{"status":"ok"}`. It only proves the API
process is alive - it never touches the database or the worker. It is there
for a Caddy or container check; none is configured today.

Phase 3 adds a deeper one, superadmin-only, for the Admin > Overview panel and
for anything watching the system from outside:

`GET /api/admin/health` - the database round-trip, the last successful poll and
how long ago, the last inbound reply we stored (not every webhook - a request
we ignored, and Twilio's, do not move it), the count of conversations due to expire
but not yet swept, and whether `EZT_SEND_GROUP` is set.

The worker is a separate process with no HTTP server, so its health has to be
inferred from what it writes: the checkpoint's timestamp is the honest signal
that it is alive, which is why the last poll time belongs in this response.

**As built** - `db/health.ts`, `api/admin/health.ts`.

Five checks, each with its own `status`, a `message` when it is degraded, and a
`detail` object. The top-level `status` is `degraded` if any check is.

| Check | Degrades when |
|---|---|
| `database` | `SELECT 1` fails. Nothing below runs; the response returns early rather than letting four more queries fail in turn |
| `poller` | The last poll was over 6 minutes ago, or there has never been one |
| `webhook` | Never - its status is `info`, not `ok`: a quiet night is not a broken webhook, so it has no verdict. Reports the last reply's time for a human to read |
| `expiry` | An open conversation is more than 10 minutes past its `expires_at`. The worker sweeps on every poll, every 30 seconds by default, so that is many missed sweeps, not one slow one |
| `sending` | `EZT_SEND_GROUP` is unset, which makes `sendMessage` refuse every send - **or** the newest send attempt of the last day was refused by EZ Texting. Reports the day's failures and the last successful send |
| `calling` | The phone number, or the TwiML App, does not point at this server - or the number is not on the account, or Twilio could not be asked. With calling not set up it is `info`: no verdict |

*(2026-09-28, Jeel: "i want all real". Until then `webhook` and `expiry` always
said `ok`, and `sending` said `ok` while EZ Texting refused every text, because
it checked only the setting. `sending` can judge real sends now that a refused
send is kept, marked failed - `db/failed-sends.ts`. `info` never makes the
whole report degraded.)*

**The poller's liveness is `settings.updated_at`, not the checkpoint's value.**
The value is the newest contact's `createdAt`, so on a quiet account it stands
still while the worker polls happily every 30 seconds - reading it would report a
healthy system as dead every time leads stop arriving. `updated_at` moves on
every successful poll. Both are in the response, so the two are not confused.
*(2026-09-28: that last sentence was not true until this date. The poller wrote
the checkpoint only when a new contact arrived, so `updated_at` stood still on a
quiet account too, and the poller check reported a healthy worker as degraded.
It now writes the checkpoint - the same value when nothing arrived - on every
successful poll. `POLLER.md`, step 7.)*
`scripts/health-live-check.ts` pins exactly this, in both directions: a
week-old value with a fresh poll is healthy, and a fresh value with a 15-minute
-old poll is not.

The 6-minute threshold is six times the old 60s interval (twelve of the 30s one since migration 005): long enough that
a slow EZ Texting page or a restart is not a false alarm, short enough that a
dead worker is noticed within the working hour.

**Only the webhook check never sets the verdict.** Leads reply when they
reply, and a quiet night is not a broken webhook: it is a time for a human to
read. Expiry does set it - any conversation more than 10 minutes past its
`expires_at` makes the report degraded, as the table says. (This paragraph
said neither did; that was true until 2026-09-28.)

**Calling is checked against Twilio, not the database** - added 2026-10-02.
Calling fails silently in one way: Twilio asks two addresses how to handle a
call - the TwiML App's Voice URL for a call a browser places, the phone
number's for a lead calling in - and if either points somewhere else, calls
simply stop arriving. Nothing crashes and nothing is logged, because the
request never reaches us. The usual cause is `twilio:configure` run from a
laptop against the number production uses. So the check asks Twilio where both
point and compares them with `PUBLIC_URL`; the message says which is wrong and
to run `npm run twilio:configure` on this server.

`integrations/twilio-health.ts`. The route adds it to the database's report
(`api/admin/health.ts`), since it is not a database check. Twilio is asked at
most once a minute - the Overview page polls every five seconds - so a fix
shows within a minute. It reports where the two point, never a credential.

It does not place a call: it proves the wiring, not that a phone rings.

**It answers 200 even when degraded.** The report is the point, and the body's
`status` is the verdict. A monitoring tool reading only the status code would
otherwise see a hard failure for a slightly late poll.

**Consequence of the superadmin guard:** anything watching from outside needs a
session, so an uptime service cannot poll this URL as it stands. That follows
this doc's original decision, and the response does say how the business is
doing rather than just whether a process is up. If external monitoring is wanted
later it should get a separate unauthenticated route returning less - not this
guard removed. Still open after Phase 4 - CLAUDE.md §10.

`GET /api/health` is untouched and still open: `{"status":"ok"}`, no database
access, for a Caddy or container check if one is added. A test asserts it never reaches the
database, since that is the whole difference between the two.

## The two ways this system goes quiet

Worth knowing when deciding what to watch, because neither one crashes anything:

- **EZ Texting starts rejecting us.** The worker keeps ticking and the API keeps
  answering; leads simply stop arriving. `poll.tick` still appears, so the
  signal is `inserted` staying at zero while `level=error` lines appear.
- **The worker dies without its container stopping.** Nothing logs at all from
  that process. The absence of `poll.tick` is the only sign, which is why the
  last poll time is in the health response rather than left to the logs.

Both are silences rather than failures, so anything watching this system should
alert on the absence of activity as well as on errors.
