# Logging and health

Phase 3. **Not built.** Today the app logs readable single lines to stdout -
`poll tick fetched=2 inserted=0 ...`, `webhook: lead 42 -> open step=1 ...` -
which Docker keeps and a person reads with `docker compose logs`. Nothing is
structured, nothing is shipped anywhere, and there is no health endpoint.

Shipping the logs off the instance is configured in `docker-compose.prod.yml`,
and `WORKFLOW.md` says what that changes about reading them - in short,
`docker compose logs` works locally and not on the server. What the code owes is
below: one queryable line per event, and a health endpoint worth polling.

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
