# Webhooks

`POST /api/webhooks/eztexting/<token>` receives the inbound SMS replies EZ
Texting posts to us. It is under `/api` because that is the only path Caddy
forwards to the API, mounted before the `/api` catch-all 404, and it is
deliberately unauthenticated - EZ Texting has no session; the path token stands
in for one. The code is `backend/src/api/webhooks.ts`; the payload's shape is in
`EZTEXTING-API.md`, "Inbound webhook". What a reply then does to the
conversation is `STATE-MACHINE.md`.

This doc is EZ Texting's webhook only. Twilio's are in `TWILIO.md` (agents'
calls, a lead calling in, how each ended, who picked up, the recording notice
and the recording), `AUTO-CALLS.md` (the automated call's `/auto/*`, "The call's webhooks") and
`AI-AGENT.md` (`/auto/ai-after`, the end of Seri's part). They differ in one way
that matters: Twilio signs every request, so those are checked by signature, not
by a secret in the path. Both kinds are kept as received in `webhook_events`
(`AUDIT.md`, "The raw webhook archive").

## How it works

### What it does

1. **Check the path token.** With one set, a wrong or missing one gets 404 and
   nothing else happens - the request is not kept ("The path token").
2. **Keep the request as it arrived** in `webhook_events`, before anything
   below and outside the handler's transaction, so a request that is ignored or
   fails is still on record.
3. **Ignore what is not a reply.** A `type` other than `inbound_text.received`,
   a payload missing `fromNumber`, `received` or `message`, or one with a field
   of the wrong kind - a sender or a text that is not a string, a `received`
   that is no time - is answered 200, so EZ Texting stops retrying, and logged
   `webhook.ignored` with reason `wrong_type`, `missing_fields` or
   `bad_fields`.
4. **Normalise `fromNumber` to E.164** and find the lead by phone. If there is
   none, stop - "Replies from numbers we hold no lead for".
5. **Insert the message**, deduped on `(from_number, received_at)`. A duplicate
   is answered 200 and logged `webhook.ignored`, reason `duplicate`.
6. **An opt-in releases the block** first, keeping the row - so anything else
   in the reply is handled as a normal message ("Opt-out and opt-in words").
7. **Run the state machine**: `applyReply` (`api/reply-flow.ts`) - "The reply
   advances the conversation".
8. **An opt-out blocks the number** in `dnc_list`, reason `sms_stop`, driven by
   the state machine's `blockNumber` - or by the opt-out itself when the lead
   has no conversation - unless the number is blocked already: its block, its
   reason and its one record stand.
9. **Flag the lead** (`has_unread_inbound`) only when a person has to read the
   reply - the state machine decides (`STATE-MACHINE.md`, "Which replies need a
   person"); a lead with no conversation is flagged too, an opt-out never.
10. **Commit, give the connection back, then send** the text the reply led to -
    the next question, a "sorry" - and answer 200. EZ Texting waits for its 200
    at most 2 seconds while the text goes (`ANSWER_WITHIN_MS`): most sends are
    done well within that and are answered after; a slow one - EZ Texting
    itself slow, up to its 30 seconds - finishes after the answer, since EZ
    Texting's callback is meant to be answered fast (`EZTEXTING-API.md`).

From the lead lookup to the flag - steps 4 to 9 - it is one transaction.

### Why dedupe on (from_number, received_at)

The payload's `id` is the id of *our* outbound message being replied to, not an
identifier for the reply. Two replies to the same question carry the same `id`,
so deduping on it would discard the second - which is what a lead correcting
themselves looks like. The phone and the millisecond timestamp together are
unique: one handset cannot send two texts in the same millisecond. The `id` is
still stored, in `in_reply_to_ezt_id`, because it says which question was being
answered.

### Replies from numbers we hold no lead for

**They are ignored.** Nothing is created - no lead, no conversation, no
message. The handler logs `webhook.ignored` with reason `no_lead` - never the
number, which the logger would redact anyway - and answers 200, so EZ Texting
stops retrying.

This is the important one. **The subscription is registered per EZ Texting
account, not per group or per sending number** (`EZTEXTING-API.md`,
"Subscriptions"), so every reply to every campaign on the account arrives here,
including the client's own marketing, which has nothing to do with this app. A
reply from a number we never texted is someone else's, not a lead of ours. Only
replies from numbers already in `leads` are processed.

**Two things are still written:**

- **An opt-out.** A STOP from such a number puts it in `dnc_list` with reason
  `sms_stop` - unless it is blocked already - even with no lead to attach it
  to; the table is keyed on phone alone. If that number is later delivered as a
  partner lead, the poller's `dnc_list` check stops us texting someone who has
  already opted out of this client's messages.
- **An opt-in.** A START from such a number releases a block we hold - it may
  be a lead the partner delivered before, or one still to come - and still
  creates nothing (`dnc.released` when it lifted one).

### A lead's reply to another campaign

A reply is matched to a lead by its phone number alone; which text it answers
(`in_reply_to_ezt_id`) is kept but never checked. So if one of our leads
answered one of the client's other campaigns, it would be read as an answer to
our question - scored, moved on, put in review, or on "YES" a block lifted.

It is left so because the leads' group is a dedicated one, pulled from by us and
never sent to by the client, so a lead's reply is a reply to our texts; the
other campaigns go to other groups, whose replies are ignored above (Decisions).
**Revisit if that changes** - a campaign sent to the whole account, or our leads
also added to a group the client markets to: then only a reply whose
`in_reply_to_ezt_id` is one of our own texts should run the questions. Whether
it has happened can be read from production at any time: inbound messages whose
`in_reply_to_ezt_id` matches no outbound `ezt_message_id` of ours.

### Opt-out and opt-in words

This handler owns the keyword lists; the state machine is told the outcome
(`STATE-MACHINE.md`, rule 1 and "Opting back in").

| | The payload flag | Or the whole message is |
|---|---|---|
| **Opt-out** (`STOP_WORDS`) | `optOut` | STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT - CTIA's standard set |
| **Opt-in** (`START_WORDS`) | `optIn` | START, UNSTOP, YES, SUBSCRIBE |

- **Case, surrounding spaces and a trailing `.`, `!` or `,` are ignored.**
  "STOP?" is not the keyword, though EZ Texting's own `optOut` may still say so.
- **The whole message must be the keyword** - "stop by tomorrow" is not an
  opt-out. A message longer than 40 characters is not a keyword and is not
  scanned (`MAX_KEYWORD_LENGTH`).
- **Never both.** A reply that is an opt-out is not an opt-in.
- The words are checked as well as the flags, so a STOP that arrives without
  `optOut` still blocks the number, and a START without `optIn` still lifts
  our block.

### The path token

`EZT_WEBHOOK_TOKEN` is a random string that becomes the last path segment:
`/api/webhooks/eztexting/<token>`. The subscription is registered against that
URL, so only EZ Texting and we know it. A wrong or missing token gets 404
rather than 401, so probing the base path gives nothing away. When the variable
is unset, the plain `/api/webhooks/eztexting` is accepted, which keeps local
`curl` testing simple.

**Production will not start without it.** Unset, or shorter than 16
characters, and the API logs `api.refused_start` with reason
`no_webhook_token` and exits, beside the check on a weak `JWT_SECRET`
(`api/startup-checks.ts`). Without it a fake reply could answer a lead's
questions or opt them out. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Registering the subscription, and receiving real replies on a laptop, are in
`RUNNING.md`.

### The reply advances the conversation

After storing the message, the handler calls `applyReply` in
`api/reply-flow.ts`, which loads the lead's newest conversation, the flow it is
on (`FLOWS.md`) and the tiers, runs the pure `step` from
`core/state-machine.ts`, and saves the result: the conversation, and the answer
as its own row in `conversation_answers`. What goes back to the lead - the
choice's reply and the next question - is one text. `STATE-MACHINE.md` is the
authority for what each reply does.

- **The send happens after the commit.** `applyReply` returns
  `{ result, send }`; the handler commits, then calls `send()`. A failed send is
  logged and leaves the conversation advanced - the lead has answered, and
  re-asking a question they already answered is worse than a missing follow-up.
  For the same reason a failed send still answers 200: a retry would not re-send.
  The lead is flagged for a person instead (`STATE-MACHINE.md`, "Sending").
- **A reply that arrives before our last text has gone out is stored and
  nothing more** (`STATE-MACHINE.md`, rule 2c), logged `reply.before_our_text`.
  The one exception: if our text has been unsent for over two minutes it is not
  on its way, and the lead is flagged for a person.
- **The connection goes back before the send.** Sending records the text
  through the pool and waits on EZ Texting in between; a handler still holding
  its own connection would wait for a second one, and ten replies in flight at
  once would empty the pool of ten and stop the whole API. So it is released
  straight after `COMMIT`. Two limits stand behind it: a request that cannot get
  a connection fails after ten seconds instead of waiting for ever
  (`db/pool.ts`), and a call to EZ Texting gives up after thirty.
- **`blockNumber` comes from the state machine's result,** not from the handler
  reading the text again. The handler decides whether the reply *is* an
  opt-out, because it holds the keyword lists; the core decides what that
  means. `blockNumber` and `releaseNumber` live in `db/dnc.ts`, the one upsert
  every path that blocks a number uses (`AGENT-WORKSPACE.md`, "Blocking a
  number");
  only a row with `released_at IS NULL` blocks anything.
- **A send to a number on `dnc_list` is refused inside `sendMessage`**, so a
  reply arriving after a STOP from elsewhere advances the conversation but sends
  nothing. The `conversation.advanced` line is written only when the reply
  produced something to send; it carries `parts` - how many pieces went into the
  one text - and `sent`, never the wording, and says `"sent": false` in that
  case.

### A reply to the missed-call text

The text sent after a call nobody answered (`INCOMING-CALLS.md`, "A missed
call") is an ordinary outbound message, and a reply to it an ordinary inbound one: it takes
the steps above and then the state machine. It is stored and flagged for a
person, whether or not the lead's questions are finished - the call that led to
the text stopped the questions (`STATE-MACHINE.md`, rule 2d, and "The missed-call
text").

## Rules

1. **200 for everything handled** - ignored events, malformed payloads,
   duplicates, numbers we hold no lead for, and a failed send: EZ Texting should
   retry none of them. **500 only on an unexpected failure** before the commit,
   where a retry is wanted; the transaction is rolled back and the dedupe makes
   the retry safe. A database error before the handler's own `try` is a 500 too
   (`asyncHandler`), never an unhandled rejection that would stop the API.
2. **A reply from a number we hold no lead for creates nothing** - only its
   opt-out or opt-in is acted on.
3. **The text back goes out only after the commit**, with the connection given
   back first.
4. **A number already blocked keeps its block**, its reason and its one record:
   a STOP again changes nothing.
5. **A keyword is the whole message**, 40 characters or fewer.
6. **Production does not start without a token** of at least 16 characters.

## Data

Writes `webhook_events` (every request with the right token, as received),
`messages` (the inbound row: `body`, `in_reply_to_ezt_id`, `from_number`,
`received_at` - unique together for inbound), `dnc_list` (through `db/dnc.ts`)
and `leads.has_unread_inbound`; the conversation and its answer through
`applyReply`. Reads `leads` by phone. Columns: `SCHEMA.md`.

## Code

| File | What it does |
|---|---|
| `backend/src/api/webhooks.ts` | `handleInbound`: the token (`rejectBadToken`), the archive, the checks, the dedupe, opt-out and opt-in (`isOptOut`, `isOptIn`, `STOP_WORDS`, `START_WORDS`), the flag, the commit, the send and the 2-second answer (`within`, `ANSWER_WITHIN_MS`) |
| `backend/src/api/reply-flow.ts` | `applyReply` - the state machine wired in |
| `backend/src/db/dnc.ts` | `blockNumber`, `releaseNumber`, `isBlockedNow` |
| `backend/src/db/activity.ts` | `archiveWebhook` - the raw archive |
| `backend/src/api/startup-checks.ts` | The production refusal without a token |
| `backend/src/db/pool.ts` | The ten-second wait for a connection |

## Tests

| What | Where |
|---|---|
| The archive, the token, ignored and duplicate requests, a number we hold no lead for, STOP and START (with and without a lead, already blocked, again after opting in), the flag, the flow advancing, the lock, the send after the commit and the 2-second answer, the connection given back, a reply before our text, a failed send | `backend/src/api/__tests__/webhooks.test.ts` |
| The token refusal in production | `backend/src/api/startup-checks.test.ts` |
| Real replies posted to the route, the token included | `backend/scripts/end-to-end.ts` |

## Not done

- **Nothing verifies the sender cryptographically.** A `secret` is passed when
  registering the subscription, but EZ Texting sends no signature header, so it
  cannot be checked. The path token is the fallback, and a weaker guarantee:
  anyone who learns the URL can post.
- **A reply is not checked against the text it answers** - "A lead's reply to
  another campaign".

## Decisions

| Decision | By | Date |
|---|---|---|
| A reply from a number we hold no lead for is ignored, not turned into a lead and a `review` conversation | Jeel | 2026-09-17 |
| Production refuses to start without `EZT_WEBHOOK_TOKEN` | Jeel | 2026-09-29 |
| A lead's reply is matched by phone alone, not checked against the text it answers: the leads' group is dedicated, never sent to by the client. Revisit if that changes | Jeel | 2026-11-23 |

## History

- 2026-11-27 · Rewritten to the area template: the steps in the code's order,
  the decisions in a table; the keyword lists owned here; registering the
  subscription, testing by hand and receiving replies locally moved to
  `RUNNING.md`; the pointer to "the list further down" of the permanent
  subscriptions, which did not exist, made a link to `EZTEXTING-API.md`, "The
  account", in what moved · `docs/DOCS.md` · D15
- 2026-11-23 · A lead's reply to another campaign: not changed · review D1
- 2026-11-22 · A field of the wrong kind answered 200 as `bad_fields` - before,
  a 500 that EZ Texting retried for ever; EZ Texting waits at most 2 seconds for
  its answer while the text back goes; a STOP from a number already blocked
  leaves its block, reason and record - the poller and the automated call
  already did so · review M13, M40
- 2026-10-06 · The connection given back straight after `COMMIT`. While the
  handler held its own, ten replies in flight each kept one and waited for
  another; the pool of ten was empty, nothing returned, and the whole API -
  sign-in, the queue, Twilio's webhooks - stopped until restarted. Reproduced
  with ten simultaneous replies and a slow send. Also a reply before our text
  (rule 2c), and `conversation.advanced` written only when there is a text:
  from 2026-10-05 it was written for every reply, STOP included, with
  `"sent": false` - the list of texts had replaced a single key, and an empty
  list still counted as something to send · review of Phase 5
- 2026-10-05 · The choice's reply and the next question sent as one text ·
  Phase 5
- 2026-10-01 · Every request kept in `webhook_events`, migration 006; the
  poller's block joined `db/dnc.ts` - it had its own insert until then
  (`POLLER.md`) · `AUDIT.md`
- 2026-09-29 · Production refuses to start without a token. Before, it was only
  a line in `.env.example`, and forgetting it left the webhook open to anyone
  who found the URL
- 2026-09-28 · `has_unread_inbound` set only when a person has to read the
  reply, after the state machine has run - it was set on every reply; the route
  wrapped in `asyncHandler`, since `pool.connect()` before the handler's own
  `try` made a database blip an unhandled rejection, which in Node 20 takes the
  API down · Phase 3
- 2026-09-26 · `blockNumber` and `releaseNumber` moved from this file to
  `db/dnc.ts` when an agent's DNC outcome became their second caller - moved
  rather than copied: a compliance table with two insert statements eventually
  holds two shapes of row · Phase 3 task 8
- 2026-09-22 · The account's webhook.site subscription found gone; two remain
  permanent (`EZTEXTING-API.md`)
- 2026-09-19 · No STOP confirmation of our own, by design: EZ Texting replies to
  STOP itself (`STATE-MACHINE.md`, Decisions)
- 2026-09-17 · Replies from numbers we hold no lead for ignored. Until then the
  handler made a bare lead and a `review` conversation for each, so a stray
  reply would reach a person; on a live account that was 34 leads of noise to 1
  real one in a day - real customers' numbers from campaigns outside this
  project, growing with every campaign the client sends
- 2026-09-15 · The first real text received through an ngrok tunnel
  (`EZTEXTING-API.md`) · Phase 1
