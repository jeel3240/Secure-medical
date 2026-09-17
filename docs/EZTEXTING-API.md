# EZ Texting API – verified findings

Tested against the client account on 2026-09-10. Use these exact endpoints and field names.

> **Update 2026-09-14 (Jeel):** this account is a test account, not the client's live account. It may be used for development, including sending. Findings below still hold; the "live" wording is kept as written on the day.

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
- `sort=createdAt,desc` genuinely sorts server-side. Verified 2026-09-11 against
  the 1773-contact group: `desc` and `asc` return entirely different first pages
  (newest 2026-07-20 vs oldest 2024-07-19), so this is not coincidental ordering.
  Do not rely on `"sorted": true` in the response as evidence - it appears even
  when the sort field is invalid.
- **The default order is ascending (oldest first).** Omitting `sort`, or passing
  an unrecognised field like `sort=bogusField,desc`, silently yields oldest-first
  rather than erroring. A typo in the sort field would leave the poller reading
  the oldest end of the group on every tick and never seeing new contacts, with
  no error to show for it.
- `filters[groupName][like]=weightloss` returns only the 3 contacts in the group
  named exactly `weightloss`, even though `like` is a substring match elsewhere.
  But `filters[groupName][like]=weightloss - sent` returns that group's 1,773, so
  the matching is on the whole group name, not a prefix. Re-verify `groups[].name`
  after fetch regardless.
- `filters[source][eq]` values: Unknown, WebInterface, Upload, WebWidget, API, Keyword. Partner leads arrive as `API`.

### Filters that work

Verified 2026-09-11 by running each against a value expected to exclude
something and checking `totalElements` actually moved.

| Filter | Notes |
|---|---|
| `filters[groupName][like]` | |
| `filters[phoneNumber][like]` | |
| `filters[firstName][like]` | |
| `filters[lastName][like]` | |
| `filters[email][like]` | |
| `filters[note][like]` | |
| `filters[firstName][eq]` | exact match |
| `filters[source][eq]` | enum, see values above |
| `filters[optOut][eq]` | `true` / `false` |

`like` is a case-insensitive substring match: `har`, `arol` and `HAROLD` all
matched "harold". Hence the group-membership re-check in the poller.

### Filters that are silently ignored

`filters[groupId]` and `filters[id]` in any form; the operators `ne`, `in`,
and `like` on `source`; and every date/time filter (below). These return the
full unfiltered set, exactly like a made-up field name.

Validation is inconsistent: `filters[source][like]=ZZZ` returns 400 (`No enum
constant ...Contact.ContactSource.ZZZ`) because `source` is a validated enum,
but `filters[bogusField][gt]=xyz` returns 200 and every row. An absent error
is not evidence a filter is working.

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
| `source` | `source` | Only accept `API`. *(2026-09-14: configurable via `EZT_SOURCE`, default `API`; test contacts added by hand are `WebInterface`.)* |
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

*As implemented, 2026-09-14* - `docs/POLLER.md` describes the real code. It
differs from the sketch above in three ways: the interval is 60 seconds by
default and read from `settings` each tick; there is no job queue, and the
opener is not sent yet; and the source filter comes from `EZT_SOURCE` rather
than being fixed to `API`.

## Send message
```
POST /v1/messages
{ "toNumbers": ["15551234567"], "message": "..." }
```
- `toNumbers` without `+` (matches how contacts come back). Confirm in sandbox whether `+1...` is also accepted.
- Response includes a message id. Store in `messages.ezt_message_id`.
- Delivery type (Standard 130 / Express 160) still unconfirmed with client. Opener is 158 chars.

## Inbound webhook

Verified against the live account 2026-09-14, and confirmed 2026-09-15 with a
real text arriving through an ngrok tunnel.

Subscriptions are API-only - there is no settings page:
`POST|GET /v1/webhooks/subscriptions`, `DELETE /v1/webhooks/subscriptions/{id}`.
Several of the same type can coexist; the account already has one pointing at
Zapier and one at webhook.site, neither of which should be removed.

**A subscription covers the whole account.** There is no group, number or
campaign filter on it: every inbound text to any of the account's numbers is
delivered to every subscription. Confirmed 2026-09-16, when replies to the
client's own marketing campaigns arrived at our callback. The handler therefore
cannot treat an unrecognised sender as a new lead - see WEBHOOKS.md.

**The `secret` passed at registration never appears on delivery.** No signature
header comes through, so the sender cannot be verified. A random segment in the
callback path is the fallback - see WEBHOOKS.md.

```json
{
  "id": "309112289003",
  "type": "inbound_text.received",
  "fromNumber": "16026203572",
  "toNumber": "15207799209",
  "message": "3",
  "received": "2026-09-14T17:06:31.042+00:00",
  "optIn": false,
  "optOut": false
}
```

| Field | Meaning |
|---|---|
| `fromNumber` | The lead's phone, no `+`. Normalize before lookup. |
| `toNumber` | Our sending number. |
| `message` | What they typed. |
| `received` | Arrival time, with milliseconds. |
| `optOut` | If true, suppress them. |
| `id` | **Not an id for the reply** - see below. |

### `id` is the outbound message being replied to

It is the id of *our* message the lead replied to, not an identifier for their
reply. Established by sending a text, noting the `id` the send API returned
(`309112289003`), then replying from the handset: the webhook came back with
that same value.

So a lead who replies twice to the same question - "3", then "sorry, 2" -
produces two webhooks carrying an identical `id`. Deduping on it would reject
the correction as a duplicate and lose it, which is a normal thing for a lead
to do mid-qualification.

**Dedupe inbound on `(fromNumber, received)`.** The same phone cannot send two
texts in the same millisecond. The id is still worth keeping, in
`messages.in_reply_to_ezt_id`, because it says which question was being
answered.

The schema reflects this: `ezt_message_id` is unique only for `direction =
'outbound'`, and a separate unique index covers `(from_number, received_at)`
for inbound. See SCHEMA.md.

- EZ Texting retries webhooks, so the dedupe is load-bearing, not defensive.
- Return 200 fast.

## Safety
- Client account contains ~120,000 real contacts. Never query without the group filter. Never send to any group other than a `dev-test` group you created.
- Developers use their own EZ Texting trial account, never these credentials.
- **Update 2026-09-14 (Jeel):** the account is a test account and these credentials may be used directly for development, including sending. The two rules above are kept for history. The `weightloss` group is the test group: contacts are added to it by hand in the dashboard (source `WebInterface`) and SMS is sent to it. Keep the group filter on every contacts query regardless, since the account is large.
