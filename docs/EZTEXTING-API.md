# EZ Texting API – verified findings

Tested against the client account on 2026-09-10. Use these exact endpoints and field names.

## Auth
- HTTP Basic Auth: account username + password. No API key.
- Env vars: `EZT_USERNAME`, `EZT_PASSWORD`
- Base URL: `https://a.eztexting.com/v1`
- Docs: https://developers.eztexting.com/reference (has a "Try It" button)
- Quick start: https://developers.eztexting.com/docs/quick-start-guide
- Legacy API (`app.eztexting.com`) is deprecated and returns dates without time. Do not use it.

## List contacts (the poller call)

```
GET /v1/contacts?filters[groupName][like]=weightloss&filters[source][eq]=API&sort=createdAt,desc&size=10&page=0
```

- `size` must be one of 10, 20, 50, 100, 200. Anything else returns 400.
- `sort=createdAt,desc` works (response shows `"sorted": true`).
- `filters[groupName][like]=weightloss` matched only the group named exactly `weightloss`, not `weightloss - sent`. Still verify `groups[].name` after fetch.
- `filters[source][eq]` values: Unknown, WebInterface, Upload, WebWidget, API, Keyword. Partner leads arrive as `API`.
- Other filters available: `filters[optOut][eq]`, `filters[phoneNumber][like]`, `filters[firstName][like]`, `filters[lastName][like]`, `filters[email][like]`.
- **No date filter exists.** Tested 2026-09-11 against a group of 3 contacts,
  one of them three months older than the cutoff. Seventeen variants all
  returned the full set: field names `createdAt`, `created`, `dateCreated`,
  `created_at`; operators `gt`, `gte`, `ge`, `$gt`, `after`, `greaterThan`,
  `min`, `from`, `start`, `between`, `eq`; values as ISO, date-only, no-Z and
  epoch millis; and top-level `since`, `startDate`, `fromDate`, `createdAfter`,
  `createdAtFrom`, `updatedAfter`.
- Controls for that test: `filters[firstName][like]=harold` returned 1 and
  `filters[optOut][eq]=true` returned 1, so filtering does reach the server,
  while a deliberately invalid `filters[bogusField][gt]=xyz` returned all 3 -
  identical to every date attempt.
- **Unrecognised filters are silently ignored, never rejected.** A filter that
  appears to work may be doing nothing. Always verify a new filter against a
  record you expect it to exclude.
- Consequence: the poller sorts `createdAt,desc` and stops reading at the
  checkpoint rather than asking the server for contacts since a given time.
- Response is Spring-Data style paging: `content[]`, `totalElements`, `totalPages`, `last`, `pageable`.

### Response shape (one contact)
```json
{
  "phoneNumber": "15127698059",
  "firstName": "harold",
  "lastName": "holland",
  "email": "x@example.com",
  "note": "weightloss",
  "source": "API",
  "values": {},
  "createdAt": "2026-06-18T15:09:12Z",
  "optOut": false,
  "groups": [
    { "id": "46383471003", "name": "weightloss", "note": "...", "contactsCount": 1 },
    { "id": "46383554003", "name": "weightloss - sent", "note": "...", "contactsCount": 1773 }
  ]
}
```

### Field mapping
| EZ Texting | Our column | Notes |
|---|---|---|
| `phoneNumber` | `leads.phone` | Arrives without `+`. Normalize to E.164: `"+" + phoneNumber`. |
| `firstName`, `lastName` | `first_name`, `last_name` | May be absent. |
| `email` | `email` | Optional. |
| `source` | `source` | Only accept `API`. |
| `createdAt` | `ezt_added_at` | ISO 8601 with seconds. This is the checkpoint field. |
| `optOut` | conversation `suppressed` + `dnc_list` | If true, never text. |
| `groups[].id`, `groups[].name` | `group_id`, `group_name` | Store both. Filter on name (API constraint), verify by id in code. |
| `values` | ignore | Custom fields. |

No `state`, no consent ref, no partner lead id come through. Do not design around them.

### Group IDs (client account)
- `weightloss` = 46383471003 (new leads land here)
- `weightloss - sent` = 46383554003 (client's existing drip moves contacts here after texting)

The client's drip must be paused at go-live or leads get texted twice. Not our code's job, but the poller must tolerate contacts being moved between these two groups.

### Poller algorithm
```
every 45s:
  checkpoint = read from settings table (ISO timestamp), default = now - 1h on first run
  page = 0
  loop:
    resp = GET /v1/contacts?filters[groupName][like]=weightloss&filters[source][eq]=API&sort=createdAt,desc&size=50&page={page}
    for c in resp.content:
      if c.createdAt <= checkpoint - 5min: goto done   # overlap window
      phone = "+" + c.phoneNumber
      if not any(g.name == "weightloss" for g in c.groups): continue
      if c.optOut:
        insert lead + conversation(status=suppressed); insert dnc_list; continue
      inserted = INSERT INTO leads (...) ON CONFLICT (phone) DO NOTHING
      if inserted:
        create conversation(status=open, step=1)
        enqueue job: send_opener(lead_id)
    if resp.last: break
    page += 1
  done:
  checkpoint = max(createdAt seen) if any else unchanged
  write checkpoint
```
Rules:
- Never advance the checkpoint on error.
- One poller instance only.
- Log per tick: fetched, inserted, skipped, duration.

## Send message
```
POST /v1/messages
{ "toNumbers": ["15551234567"], "message": "..." }
```
- `toNumbers` without `+` (matches how contacts come back). Confirm in sandbox whether `+1...` is also accepted.
- Response includes a message id. Store in `messages.ezt_message_id`.
- Delivery type (Standard 130 / Express 160) still unconfirmed with client. Opener is 158 chars.

## Inbound webhook
- Not yet verified. Check the Webhooks section of the API reference (Create Webhook / List Webhooks).
- Expected payload: sender phone, message text, message id, timestamp. Confirm exact field names in the developer's trial account before writing the parser.
- Dedupe on message id; EZ Texting may retry.
- Return 200 fast.

## Safety
- Client account contains ~120,000 real contacts. Never query without the group filter. Never send to any group other than a `dev-test` group you created.
- Developers use their own EZ Texting trial account, never these credentials.
