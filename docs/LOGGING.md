# Logging, health and CloudWatch

Phase 3. **Not built.** Today the app logs readable single lines to stdout -
`poll tick fetched=2 inserted=0 ...`, `webhook: lead 42 -> open step=1 ...` -
which Docker keeps and a person reads with `docker compose logs`. Nothing is
structured, nothing is shipped anywhere, and there is no health endpoint.

Jeel asked Nilesh to add CloudWatch on 2026-09-23. This doc is what has to be
true on our side for that to be worth anything.

## Structured logs

One JSON object per line on stdout, so CloudWatch Logs Insights can query
fields instead of matching substrings. Keep the existing lines' information;
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
for CloudWatch to alarm on:

`GET /api/admin/health` - the database round-trip, the last successful poll and
how long ago, the last inbound webhook, the count of conversations due to expire
but not yet swept, and whether `EZT_SEND_GROUP` is set.

The worker is a separate process with no HTTP server, so its health has to be
inferred from what it writes: the checkpoint's timestamp is the honest signal
that it is alive, which is why the last poll time belongs in this response.

## What Nilesh needs to decide

Ours is the log format; the shipping is his. The questions worth agreeing before
the work starts:

1. **How logs leave the container** - the `awslogs` Docker log driver, which
   needs credentials on the instance and is set per service in
   `docker-compose.prod.yml`, or the CloudWatch agent tailing the Docker log
   files. The driver is simpler; the agent survives a Docker restart better.
2. **Log group and stream names**, one group per service (`/secure-medical/api`,
   `/secure-medical/worker`) so the two are separable.
3. **Retention**, because the default is forever and these logs are chatty.
4. **What alarms.** The three worth having: any `level=error`, no `poll.tick`
   for ten minutes, and the API health check failing. The first two catch the
   two ways this system goes quietly wrong - EZ Texting rejecting us, and the
   worker dying without the container stopping.

Note for whoever wires this: a container that logs to CloudWatch through the
`awslogs` driver no longer answers `docker compose logs`. That is the normal
trade and it surprises people at 2am.
