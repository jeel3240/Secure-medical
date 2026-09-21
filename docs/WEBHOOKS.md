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
3. Find the lead by phone. **If there is none, stop**: log it, opt the number
   out if the reply was a STOP, return 200, and create nothing - see below.
4. Insert the message, deduped on `(from_number, received_at)`.
5. Set `leads.has_unread_inbound`.
6. If it is an opt-out, add to `dnc_list` and suppress any open conversation. A
   lead can opt out with no open conversation - already completed, for instance -
   and the `dnc_list` row is what blocks future contact either way.
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

## Replies from numbers we hold no lead for

**They are ignored.** Nothing is created: no lead, no conversation, no message.
The handler logs the number, returns 200 so EZ Texting stops retrying, and
moves on.

This is the important one. **The subscription is registered per EZ Texting
account, not per group or per sending number**, so every reply to every campaign
on the account arrives here - including the client's own marketing drips, which
have nothing to do with this app. A reply from a number we never texted is
therefore someone else's, not a lead of ours.

Until 2026-09-17 the handler created a bare lead and a conversation in `review`
for these, on the reasoning that a stray reply should reach a human rather than
be dropped. On a live account that produced 34 leads of noise against 1 real
one in a day - real customer phone numbers from campaigns outside this project,
growing with every campaign the client sends. Only replies from numbers already
in `leads` are processed.

**One thing is still written: an opt-out.** If the reply is a STOP, the number
goes into `dnc_list` with reason `sms_stop`, even with no lead to attach it to -
the table is keyed on phone alone. If that number is later delivered as a
partner lead, the poller's `dnc_list` check stops us texting someone who has
already opted out of this client's messages.

Opt-out is `optOut` on the payload, or the message being one of the CTIA
keywords: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT. Case
and trailing punctuation are ignored, and the whole message must be the keyword -
"stop by tomorrow" is not an opt-out.

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

## The reply advances the conversation

After storing the message, the handler calls `applyReply` in
`api/reply-flow.ts`, which loads the lead's newest conversation and the
admin-editable rules, runs the pure `step` from `core/state-machine.ts`, and
saves the result. STATE-MACHINE.md is the authority for what each reply does.

Two details matter here:

**The send happens after the commit.** `applyReply` returns
`{ result, send }`; the handler commits, then calls `send()`. A failed send is
logged and leaves the conversation advanced - the lead has answered, and
re-asking a question they already answered is worse than a missing follow-up.
For the same reason a failed send still returns 200: a retry would not re-send.

**`blockNumber` comes from the state machine's result,** not from the handler
re-reading the text. The handler decides whether the reply *is* an opt-out,
because it holds the keyword list; the core decides what that means.

## Not done yet

**The expiry sweep.** `expires_at` is set on every send, but nothing yet marks
a conversation past it as `expired`. That is a worker job.

**We never send a STOP confirmation, by design** (decided 2026-09-19). EZ
Texting replies to STOP itself, so one from us would reach the lead as a second
unsubscribe message. See EZTEXTING-API.md, "STOP handling".

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
