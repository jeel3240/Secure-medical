# Webhooks

`POST /api/webhooks/eztexting` receives inbound SMS replies.

Under `/api` because that is the only path Caddy forwards to the API. It is
mounted before the `/api` catch-all 404, and is deliberately unauthenticated -
EZ Texting has no session.

Code: `backend/src/api/webhooks.ts`. Payload shape: `docs/EZTEXTING-API.md`.

## What it does

1. Ignore anything whose `type` is not `inbound_text.received`, and any payload
   missing `fromNumber`, `received` or `message`. Both return 200 so EZ Texting
   stops retrying.
2. Normalise `fromNumber` to E.164.
3. Find the lead by phone. If there is none, create one and a conversation in
   `review` - see below.
4. Insert the message, deduped on `(from_number, received_at)`.
5. Set `leads.has_unread_inbound`.
6. If `optOut`, add to `dnc_list` and suppress any open conversation. A lead can
   opt out with no open conversation - already completed, or created by this
   webhook in `review` - and the `dnc_list` row is what blocks future contact
   either way.
7. Return 200.

All of it runs in one transaction.

## Why dedupe on (from_number, received_at)

The payload's `id` is the id of *our* outbound message being replied to, not an
identifier for the reply. Two replies to the same question carry the same `id`,
so deduping on it would discard the second - which is what a lead correcting
themselves looks like. The phone and millisecond timestamp together are unique;
the same handset cannot send two texts in the same millisecond.

The `id` is still stored, in `in_reply_to_ezt_id`, because it says which
question was being answered.

## Replies from unknown numbers

A reply from a phone with no lead - someone texting the number cold, or a lead
since deleted - creates a bare lead holding only the phone, plus a conversation
at `status = 'review'`. That puts it in front of a human instead of dropping it.
Name, source and group are all null, because nothing in the payload carries
them.

## The path token

`EZT_WEBHOOK_TOKEN` is a random string that becomes the last path segment:
`/api/webhooks/eztexting/<token>`. The subscription is registered against that
URL, so only EZ Texting and we know it.

A wrong or missing token gets 404 rather than 401, so probing the base path
gives nothing away. When the variable is unset the plain path is accepted,
which keeps local `curl` testing simple - production should always set it.

Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

## Registering the subscription

There is no settings page for this; it is API-only.

```bash
POST https://a.eztexting.com/v1/webhooks/subscriptions
{ "type": "inbound_text.received",
  "callbackUrl": "https://<host>/api/webhooks/eztexting/<token>",
  "secret": "<token>" }
```

`GET` the same path to list, `DELETE /webhooks/subscriptions/{id}` to remove
one. Locally the callback is an ngrok URL, which changes each time ngrok
restarts, so the subscription has to be re-registered per session and deleted
afterwards.

**The account already has other subscriptions of this type** - one pointing at
Zapier, one at webhook.site. Several can coexist. Do not delete them.

## Status codes

200 for everything handled, including ignored events, malformed payloads and
duplicates - EZ Texting should not retry any of those.

500 only on an unexpected failure, where a retry is wanted. The dedupe makes
retrying safe.

## Not done yet

**The state machine.** The message is stored, but nothing reads it: no answer
is saved to `q1`/`q2`/`q3`, no score, no advance, no next question sent. The
TODO sits at the end of the handler. Week 2.

**Nothing verifies the sender cryptographically.** A `secret` is passed when
registering the subscription, but EZ Texting sends no signature header, so it
cannot be checked. The path token described above is the fallback, and it is a
weaker guarantee: anyone who learns the URL can post.

## Testing it by hand

```bash
curl -X POST http://localhost:3000/api/webhooks/eztexting/$EZT_WEBHOOK_TOKEN \
  -H 'Content-Type: application/json' \
  -d '{"id":"309112289003","type":"inbound_text.received",
       "fromNumber":"16026203572","toNumber":"15207799209",
       "message":"3","received":"2026-09-14T17:06:31.042+00:00",
       "optIn":false,"optOut":false}'
```

Posting it twice should store one row. Changing `received` but not `id` - a
lead correcting their answer - should store two.
