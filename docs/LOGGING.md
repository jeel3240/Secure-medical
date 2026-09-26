# Logging and health

Phase 3. **The health endpoint is built** (task 13, 2026-09-26);
**structured logging is not** (task 26). Today the app logs readable single lines
to stdout - `poll tick fetched=2 inserted=0 ...`, `webhook: lead 42 -> open
step=1 ...` - so nothing can be queried by field yet.

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
| `webhook` | Never. Reported for a human to read |
| `expiry` | Never. Reports how many open conversations are past `expires_at` |
| `sending` | `EZT_SEND_GROUP` is unset, which makes `sendMessage` refuse every send |

**The poller's liveness is `settings.updated_at`, not the checkpoint's value.**
The value is the newest contact's `createdAt`, so on a quiet account it stands
still while the worker polls happily every minute - reading it would report a
healthy system as dead every time leads stop arriving. `updated_at` moves on
every successful poll. Both are in the response, so the two are not confused.
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
