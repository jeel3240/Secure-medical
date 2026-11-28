# EZ Texting API

How EZ Texting's REST API behaves, as this app uses it: the endpoints, the contact
filters, the field mapping, the inbound webhook, and every finding behind them with
its evidence and date. Use these exact endpoints and field names; a filter that
seems to work may be doing nothing ("Filters that are silently ignored"). The
client is `backend/src/integrations/ezt-client.ts`; what the poller and the webhook
do with the answers is `POLLER.md` and `WEBHOOKS.md`. EZ Texting's own reference,
with a "Try It" button for each call: https://developers.eztexting.com/reference -
and its quick start: https://developers.eztexting.com/docs/quick-start-guide.

## The account

| Rule | Why |
|---|---|
| The credentials in a local `.env` are a **test account**, which may be used for development, sending included. Its `weightloss` group is the test group: add contacts to it by hand in the dashboard - they arrive with source `WebInterface` - and send to it. Test settings: `EZT_GROUP=weightloss`, `EZT_SOURCE=WebInterface`, `EZT_SEND_GROUP=weightloss` (`ENVIRONMENT.md`) | Jeel's decision, "Decisions" |
| Production's credentials are held by Jeel and set only on the server; developers get the test account's | `CLAUDE.md`, credentials |
| **Every contacts query is scoped to one group** - `listContacts` refuses without `groupName` | The account holds about 120,000 contacts |
| Partner leads in production arrive with source `API` | How the partner adds them |
| Two webhook subscriptions are permanent and are never removed: the client's Zapier one and production's | Others rely on them |
| A tunnel's subscription is registered when local testing starts and deleted when it stops | "Inbound webhook" |

## Endpoints

Base URL `https://a.eztexting.com/v1`. HTTP Basic Auth with the account's username
and password - no API key - from `EZT_USERNAME` and `EZT_PASSWORD`. The legacy API
(`app.eztexting.com`) is deprecated and returns dates without times; it is not used.

| Call | What | Used by |
|---|---|---|
| `GET /v1/contacts` | A page of contacts, filtered and sorted | The poller - `listContacts` |
| `POST /v1/messages` | Send a text: `{ "toNumbers": ["15551234567"], "message": "..." }` | Every send - `sendMessage` |
| `GET`, `POST /v1/webhooks/subscriptions`; `DELETE /v1/webhooks/subscriptions/{id}` | List, register and remove inbound-webhook subscriptions. API-only: there is no settings page | By hand - `RUNNING.md`, "Registering the subscription" |
| `GET /v1/contacts/{phoneNumber}` | One contact | Not by the app - the 2026-11-27 test |
| `POST /v1/contacts` | Create a contact - or, for a number already there, update it; `groupIdsAdd` adds groups | Not by the app - the 2026-11-27 test |
| `POST /v1/contact-groups/{id}/contacts?phoneNumbers=...` | Add contacts to a group | Not by the app - the 2026-11-27 test |

## Listing contacts

The poller's query:

```
GET /v1/contacts?filters[groupName][like]=weightloss&filters[source][eq]=API&sort=createdAt,desc&size=50&page=0
```

| Parameter | Behaviour |
|---|---|
| `size` | One of 10, 20, 50, 100, 200; anything else is a 400 |
| `sort=createdAt,desc` | Sorts on the server, newest first. **The default is oldest first**: omitting `sort`, or an unknown field such as `sort=bogusField,desc`, silently gives oldest-first with no error - a typo would leave the poller reading the oldest end of the group on every tick, never seeing a new contact. `"sorted": true` in the response proves nothing: it appears even when the sort field is invalid |
| `filters[groupName][like]` | Matches the **whole** group name: `weightloss` returns only the group named exactly `weightloss`, not `weightloss - sent`. Re-check `groups[].name` after fetching regardless (`isInGroup`) |
| `filters[source][eq]` | One of `Unknown`, `WebInterface`, `Upload`, `WebWidget`, `API`, `Keyword` |
| `page` | From 0. The response is Spring Data paging: `content[]`, `totalElements`, `totalPages`, `last`, `pageable` |

There is **no date filter**, so the poller sorts newest first and stops reading at
its checkpoint rather than asking for contacts since a time (`POLLER.md`).

### Filters that work

Each was run against a value expected to exclude something, and `totalElements`
moved.

| Filter | Notes |
|---|---|
| `filters[groupName][like]` | |
| `filters[phoneNumber][like]` | |
| `filters[firstName][like]` | |
| `filters[lastName][like]` | |
| `filters[email][like]` | |
| `filters[note][like]` | |
| `filters[firstName][eq]` | Exact match |
| `filters[source][eq]` | The values above |
| `filters[optOut][eq]` | `true` or `false` |

`like` is a case-insensitive substring match: `jam`, `ami` and `JAMIE` all matched
"jamie" - hence the poller's group re-check.

### Filters that are silently ignored

`filters[groupId]` and `filters[id]` in any form; the operators `ne`, `in`, and
`like` on `source`; and every date or time filter. These return the full,
unfiltered set, exactly as a made-up field name does: **an unrecognised filter is
ignored, never rejected**, so a new filter is verified against a record it should
exclude. Validation is uneven: `filters[source][like]=ZZZ` is a 400 (`No enum
constant ...Contact.ContactSource.ZZZ`), because `source` is a validated enum, while
`filters[bogusField][gt]=xyz` is a 200 with every row.

### One contact

```json
{
  "phoneNumber": "15125550163",
  "firstName": "jamie",
  "lastName": "rivera",
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

A contact has no id of its own: the phone number is its identity. There is no
`updatedAt`, though the API reference lists one.

### Field mapping

| EZ Texting | Our column | Notes |
|---|---|---|
| `phoneNumber` | `leads.phone` | Arrives without the `+`; stored E.164, `"+" + phoneNumber` (`toE164`) |
| `firstName`, `lastName` | `first_name`, `last_name` | May be absent |
| `email` | `email` | Optional |
| `source` | `source` | Only contacts of `EZT_SOURCE` are taken - `API` by default |
| `createdAt` | `ezt_added_at` | ISO 8601 with seconds; the poller's checkpoint |
| `optOut` | a `suppressed` conversation and a `dnc_list` row | True: never texted |
| `groups[].id`, `groups[].name` | `group_id`, `group_name` | Both stored; filtered by name and checked by exact name in code (`isInGroup`) |
| `values` | - | Custom fields, ignored |

No state, no consent reference and no partner lead id come through - nothing is
designed around them.

### The account's groups

| Group | Id | What |
|---|---|---|
| `weightloss` | 46383471003 | Where new leads land |
| `weightloss - sent` | 46383554003 | Where the client's own drip moves contacts after texting them |

A drip texting the leads' group would text them twice, so it is paused at go-live -
the client's job, not our code's; the poller tolerates a contact moving between the
two groups.

## Sending

`POST /v1/messages` with `toNumbers` without the `+`, as contacts come back
(`fromE164`). The response carries the message's id, stored in
`messages.ezt_message_id`. Whether `+1…` is also accepted is not checked - the app
never sends it.

The account's delivery type, Standard (130 characters) or Express (160), is not
confirmed with the client. The antibiotics opener is 130 characters plus the first
name - 134 for a four-letter name, up to 160 for a thirty-letter one; a longer name
is sent as "there" so it never goes over (`SEGMENT_LIMIT`, `core/messages.ts`). So
it is one segment on Express and two on Standard - worth settling before real
volume.

## Inbound webhook

A subscription posts every inbound text to our callback:

```json
{
  "id": "309112289003",
  "type": "inbound_text.received",
  "fromNumber": "16025550147",
  "toNumber": "15205550109",
  "message": "3",
  "received": "2026-09-14T17:06:31.042+00:00",
  "optIn": false,
  "optOut": false
}
```

| Field | Meaning |
|---|---|
| `fromNumber` | The lead's phone, without the `+` |
| `toNumber` | Our sending number |
| `message` | What they typed |
| `received` | Arrival time, with milliseconds |
| `optOut` | True: they opted out |
| `optIn` | True: they opted back in - the same as a START |
| `id` | **Not an id for the reply** - below |

### `id` is the outbound message being replied to

It is the id of *our* message the lead replied to. Sending a text, noting the id the
send returned (`309112289003`) and replying from the handset brought back a webhook
with that same value. So a lead who replies twice to one question - "3", then
"sorry, 2" - produces two webhooks with the same `id`: deduping on it would lose the
correction. The app dedupes on `(fromNumber, received)` instead, and keeps the `id`
in `messages.in_reply_to_ezt_id`, as it says which question was answered
(`WEBHOOKS.md`, "Why dedupe on (from_number, received_at)"; `SCHEMA.md`, `messages`).
EZ Texting retries webhooks, so the dedupe is load-bearing; the handler returns 200
fast.

### Subscriptions

| Behaviour | What it means for us |
|---|---|
| **A subscription covers the whole account** - no group, number or campaign filter: every inbound text to any of the account's numbers goes to every subscription | Replies to the client's own campaigns reach us; an unknown sender is never a new lead (`WEBHOOKS.md`, "Replies from numbers we hold no lead for") |
| Several of the same type coexist | Ours sits beside the client's Zapier one |
| **A subscription whose callback keeps failing is disabled**, and the account emailed with its id. A disabled one still lists normally in `GET /v1/webhooks/subscriptions`; the only way back is to create it again | The list alone does not show a webhook works |
| **A tunnel's subscription outlives the tunnel.** A quick cloudflared or ngrok address is random and released when the tunnel stops, so texts keep being posted - path token and all - to a hostname that is no longer ours until EZ Texting gives up; free hostnames are recycled, so someone else could be handed the client's inbound texts | Delete a tunnel's subscription when testing stops (`RUNNING.md`, "Receiving real replies locally") |
| **The `secret` given at registration never appears on delivery**, and no signature header comes | The sender cannot be verified; a random segment in the callback path stands in (`WEBHOOKS.md`, "The path token") |

## One contact per phone number

EZ Texting does not allow two contacts with the same number: a number already on
the account cannot be added as a second contact. A number delivered again
**updates the existing contact** - it adds the new group and keeps the old ones -
and **`createdAt` never moves**. Only the partner sees the 200 instead of a 201;
nothing on the contact says it came back. What does change is `groups[]`: a
contact the poller already took in for one group, seen in a group it was not in, is
the only sign of a return, and the poller sees it only by reading that group past
its `createdAt` cutoff (`POLLER.md`; `BUCKETS.md`, "Finding people: two groups per
bucket").

The test, on the test account: a made-up number (+1 480 555 0142) created through
`POST /v1/contacts` in a new group A, then added to two more new groups 75 seconds
apart, and read back after each step with `GET /v1/contacts/{phoneNumber}` and the
poller's own list query on that group. Everything was deleted afterwards; nothing
was texted.

| Step | Response | `createdAt` (UTC) | Groups |
|---|---|---|---|
| `POST /v1/contacts`, `groupIdsAdd: [A]` - a new number | 201, `{"id": "<phone>"}` | 22:48:45 | A |
| `POST /v1/contacts` again, the same number, `groupIdsAdd: [B]` - the partner's way | **200**, `{"id": "<phone>"}` - updated, not refused | 22:48:45 | A, B |
| `POST /v1/contact-groups/{C}/contacts?phoneNumbers=<phone>` | 200, `["<phone>"]` | 22:48:45 | A, B, C |

The keys returned, by either read: `phoneNumber`, `firstName`, `lastName`, `source`,
`values`, `createdAt`, `optOut`, `groups`. `sort=updatedAt,desc` is accepted, which
proves nothing.

## STOP handling

A lead texting STOP to the account's number gets EZ Texting's own reply at once,
before our webhook is involved:

> PillRx: You have opted out of this program & will no longer receive any
> messages. Reply REPORT to report unwanted messaging. Text START to opt back in.

EZ Texting also sets the contact's `optOut` to `true`, which the poller reads.
Texting START sets it back to `false`, and the inbound payload carries `optIn` as
well as `optOut`, which is how an opt-in arrives beside the keyword. "PillRx" is the
brand configured on the account and appears in its compliance replies; our texts
sign as "eDrugstore", and which name is right is the client's call. What our app
does on a STOP and a START - nothing sent, the number blocked, the block lifted - is
`STATE-MACHINE.md`, "What STOP does, end to end" and "Opting back in".

EZ Texting answers HELP and INFO itself too, with the account's help text: INFO
never reaches us as a reply to our question, which is why the antibiotics flow says
"Learn more" rather than "reply INFO" ("Findings").

## Findings

| Finding | Evidence | Date |
|---|---|---|
| The endpoints and field names above hold | Tested against the account | 2026-09-10 |
| `size` must be one of 10, 20, 50, 100, 200 | Any other value is a 400 | 2026-09-10 |
| `filters[groupName][like]` matches the whole group name | `like=weightloss` returned the 3 contacts of `weightloss`; `like=weightloss - sent` returned that group's 1,773 | 2026-09-10 |
| `sort=createdAt,desc` sorts on the server | Against the 1,773-contact group, `desc` and `asc` returned entirely different first pages - newest 2026-07-20, oldest 2024-07-19 | 2026-09-11 |
| The default order is oldest first, and an unknown sort field is silently ignored | Omitting `sort`, and `sort=bogusField,desc`, both gave oldest-first with no error | 2026-09-11 |
| The working filters, and `like`'s case-insensitive substring match | Each run against a value expected to exclude something; `jam`, `ami` and `JAMIE` all matched "jamie" | 2026-09-11 |
| No date filter exists | Against a group of 3 contacts, one three months older than the cutoff, seventeen variants all returned the full set: field names `createdAt`, `created`, `dateCreated`, `created_at`; operators `gt`, `gte`, `ge`, `$gt`, `after`, `greaterThan`, `min`, `from`, `start`, `between`, `eq`; values as ISO, date-only, no-Z and epoch millis; top-level `since`, `startDate`, `fromDate`, `createdAfter`, `createdAtFrom`, `updatedAfter`. Controls: `filters[firstName][like]=jamie` returned 1 and `filters[optOut][eq]=true` returned 1, while `filters[bogusField][gt]=xyz` returned all 3 - identical to every date attempt | 2026-09-11 |
| The inbound webhook's payload is as above | Against the account; then a real text arriving through an ngrok tunnel on 2026-09-15 | 2026-09-14 |
| `id` is the id of our message being replied to | A text sent, its id noted (`309112289003`), a reply from the handset: the webhook carried the same value | 2026-09-14 |
| The registration `secret` never appears on delivery | No signature header on any delivery | 2026-09-14 |
| A subscription covers the whole account | Replies to the client's own marketing campaigns arrived at our callback | 2026-09-16 |
| One contact per phone number | Checked by Jeel | 2026-09-19 |
| STOP gets EZ Texting's own reply and sets `optOut` | STOP texted to the account's number from a test handset | 2026-09-19 |
| START sets `optOut` back to `false` | START texted from a test handset | 2026-09-22 |
| A failing subscription is disabled, and the account emailed | An email about a subscription pointing at a dead ngrok tunnel | 2026-09-22 |
| The account holds two subscriptions: the client's Zapier one and production's | The list; the webhook.site one seen on 2026-09-14 was gone, and who removed it is not recorded | 2026-09-22 |
| EZ Texting answers STOP, HELP and INFO itself; INFO never reaches us as a reply to our question - the lead gets the account's help text | INFO texted to the account from a test handset - so the antibiotics flow says "Learn more", not "reply INFO" (`FLOWS.md`, Decisions) | 2026-10-05 |
| "Learn more" passes through to our webhook, and EZ Texting sends nothing of its own for it | Texted from a test handset in the real-phone walk of the antibiotics flow | 2026-10-06 |
| A text over 160 characters arrives as one message on the handset | The 243-character reply to No on `q2` joined with `q3`, in the same walk | 2026-10-06 |
| Two texts sent 1.2 seconds apart reached our webhook 33 milliseconds apart - EZ Texting delivered them together | The same walk; why a reply before our text is not an answer (`STATE-MACHINE.md`, rule 2c) | 2026-10-06 |
| A number delivered again updates the contact; `createdAt` never moves; there is no `updatedAt`; only `groups[]` changes | "One contact per phone number" - the three-step test | 2026-11-27 |

## Decisions

| Decision | By | Date |
|---|---|---|
| The account behind the development credentials is a test account: it may be used for development, sending included, with `weightloss` as the test group | Jeel | 2026-09-14 |

## How to add an entry

1. Check the behaviour against the test account - with a control that proves the
   call did something, since EZ Texting ignores what it does not know.
2. Write it here in the same commit as any code that relies on it: a row in
   "Findings" with its evidence and date, and the endpoint, filter or field in its
   table. Then a History line.

## History

- 2026-11-27 · Rewritten as a reference: endpoints, filters, field map, webhook fields, and findings with evidence and date; the account's rules kept here, as the one owner; the poller sketch (every 45 s, an enqueued opener job) handed to `POLLER.md`, which has the real cycle; STOP's effects and the dedupe left to `STATE-MACHINE.md` and `WEBHOOKS.md`; the "unchecked" `createdAt` question closed by the day's test · D12
- 2026-11-27 · Four findings from the real-phone walks of the antibiotics flow (2026-10-05, 2026-10-06), until then told only in `FLOWS.md` and `STATE-MACHINE.md`: HELP and INFO answered by EZ Texting, "Learn more" passed through, a long text arriving as one, two texts delivered together; the subscription and tunnel links pointed at `RUNNING.md` · D14, D23
- 2026-11-27 · The test of a number delivered again: updated, `createdAt` unmoved, no `updatedAt` · `BUCKETS.md`
- 2026-10-05 · Our texts sign as "eDrugstore" - they signed "Secure Medical" until then; the opener is the antibiotics one, 130 characters plus the name (the first opener was 147) · Phase 5, flows
- 2026-09-22 · Two subscriptions on the account; the webhook.site one gone
- 2026-09-19 · One contact per phone number confirmed; whether a re-delivery resets `createdAt` left unchecked until 2026-11-27
- 2026-09-14 · The account is a test account (Jeel). Until then it was treated as the client's live account: never query without the group filter, never send to any group but a `dev-test` group of our own phones, and developers to use their own EZ Texting trial account, never these credentials. The source filter made configurable, `EZT_SOURCE`, default `API` - contacts added by hand are `WebInterface`
- 2026-09-10 · Written: tested against the account that day, with a sketch of the poller - every 45 seconds, a `send_opener` job enqueued for each new lead, the group and source written in. The real poller differs: every 30 seconds from `settings`, the opener sent in the same cycle with no job queue, the group and source from `EZT_GROUP` and `EZT_SOURCE`, a phone already on `dnc_list` saved suppressed too, the conversation started on the active flow's first question (`POLLER.md`)
