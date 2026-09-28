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
  `poll.tick`, `webhook.received`, `webhook.ignored`, `sms.sent`,
  `sms.failed`, `conversation.advanced`, `conversation.expired`,
  `lead.created`, `auth.login_failed`.
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
| `api.started`, `api.refused_start` | `api/index.ts` |
| `worker.started`, `poll.tick`, `poll.failed` | `worker/index.ts` |
| `conversation.expired`, `expiry.failed` | `worker/index.ts` |
| `sms.sent`, `sms.failed`, `sms.no_template`, `sms.name_dropped`, `sms.record_failed` | `worker/poller.ts`, `api/reply-flow.ts`, `db/agent-sms.ts`, `db/failed-sends.ts` |
| `webhook.rejected`, `webhook.ignored`, `webhook.failed` | `api/webhooks.ts` |
| `conversation.advanced` | `api/webhooks.ts` |
| `dnc.blocked`, `dnc.released` | `api/webhooks.ts` |
| `http.unhandled` | `api/http.ts` |

A new event belongs in this table as well as in the code, or whoever is querying
the logs will never know to look for it.

### What is deliberately not structured

`src/cli/create-superadmin.ts` and `src/config.ts` still use `console`. The CLI
prints a one-time password to a human's terminal - that must never become a
shipped JSON log line - and `config.ts` runs before anything else exists, to say
which env var is missing.

## Health endpoint

`GET /api/health` exists and answers `{"status":"ok"}`. It only proves the API
process is alive - it never touches the database or the worker, so it stays as
it is for Caddy and container checks.

Phase 3 adds a deeper one, superadmin-only, for the Admin > Overview panel and
for anything watching the system from outside:

`GET /api/admin/health` - the database round-trip, the last successful poll and
how long ago, the last inbound webhook, the count of conversations due to expire
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
| `expiry` | An open conversation is more than 10 minutes past its `expires_at`. The worker sweeps about once a minute, so that is several missed sweeps, not one slow one |
| `sending` | `EZT_SEND_GROUP` is unset, which makes `sendMessage` refuse every send - **or** the newest send attempt of the last day was refused by EZ Texting. Reports the day's failures and the last successful send |

*(2026-09-28, Jeel: "i want all real". Until then `webhook` and `expiry` always
said `ok`, and `sending` said `ok` while EZ Texting refused every text, because
it checked only the setting. `sending` can judge real sends now that a refused
send is kept, marked failed - `db/failed-sends.ts`. `info` never makes the
whole report degraded.)*

**The poller's liveness is `settings.updated_at`, not the checkpoint's value.**
The value is the newest contact's `createdAt`, so on a quiet account it stands
still while the worker polls happily every minute - reading it would report a
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

The 6-minute threshold is six times the default 60s interval: long enough that
a slow EZ Texting page or a restart is not a false alarm, short enough that a
dead worker is noticed within the working hour.

**The webhook and expiry checks never set the verdict.** Leads reply when they
reply, and a quiet night is not a broken webhook; a few unswept expiries between
sweeps are normal. They are numbers for a human, not alarms.

**It answers 200 even when degraded.** The report is the point, and the body's
`status` is the verdict. A monitoring tool reading only the status code would
otherwise see a hard failure for a slightly late poll.

**Consequence of the superadmin guard:** anything watching from outside needs a
session, so an uptime service cannot poll this URL as it stands. That follows
this doc's original decision, and the response does say how the business is
doing rather than just whether a process is up. If external monitoring is wanted
later it should get a separate unauthenticated route returning less - not this
guard removed. Worth settling with Jeel before Phase 4.

`GET /api/health` is untouched and still open: `{"status":"ok"}`, no database
access, for Caddy and the container check. A test asserts it never reaches the
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
