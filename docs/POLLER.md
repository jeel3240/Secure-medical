# Poller

Pulls new leads out of EZ Texting into `leads`. Runs in the worker process,
one cycle at a time, every 60 seconds.

Code: `backend/src/worker/poller.ts` and `backend/src/worker/index.ts`.
API behaviour it depends on: `docs/EZTEXTING-API.md`.

The worker tick does two things: this poll, then the expiry sweep in
`worker/expiry.ts`, each in its own try/catch so a failure on one does not stop
the other. Expiring is local work that must keep happening while EZ Texting is
unreachable. The sweep's rules are in STATE-MACHINE.md, "Expiry"; what the
poller owns is setting `expires_at` when the opener goes out.

## Why polling

EZ Texting does not tell us when a contact appears, so we ask. There is also no
date filter on the contacts endpoint - see EZTEXTING-API.md, where every
plausible spelling was tested - so we cannot ask for "contacts since X" and let
the server do the work.

Instead we ask for the group sorted newest-first and stop reading at the first
contact we have already seen. The checkpoint does client-side what a date
filter would have done server-side.

## A cycle

1. Read `ezt_poll_checkpoint` from `settings`. Absent means look back one hour.
2. Subtract `poll_overlap_minutes` (5) to get the cutoff.
3. Request page 0 of the group, `sort=createdAt,desc`, 50 per page.
4. Walk the page. Stop the whole cycle at the first contact at or older than the
   cutoff - everything below it is older still.
5. For each contact above the cutoff:
   - confirm it is really in the group, by exact name against `groups[]`
   - normalise the phone to E.164
   - if `optOut`, or the phone is on `dnc_list`: insert the lead with a
     `suppressed` conversation and add it to `dnc_list`
   - otherwise insert the lead with an `open` conversation at step 1, then send
     question 1 and record it as an outbound message
6. If the page was not the last, request the next one.
7. Write the checkpoint to the newest `createdAt` actually seen - or, when
   nothing new arrived, write the same value again. *(2026-09-28: every
   successful poll now writes it, so `settings.updated_at` is the time of the
   last poll. Before, a quiet account left it standing still and the health
   check and Admin > Leads reported a healthy worker as stopped.)*

## Why each piece is there

**The 5 minute overlap.** Deliberately re-reads contacts already processed, in
case one becomes visible slightly after its `createdAt`. Re-reading is free
because the insert dedupes.

**`ON CONFLICT (phone) DO NOTHING`.** The API has no per-contact id, so phone is
the only stable identity. This is what stops a restart from duplicating every
lead, and what makes the overlap window safe.

**The group re-check.** The `groupName` filter is a `like` match. Membership is
verified against `groups[]` rather than trusted from the filter.

**Checkpoint written last, and only on success.** A throw anywhere leaves it
untouched, so the next cycle re-covers the same ground rather than skipping it.

**A failed opener does not fail the cycle.** `sendOpener` catches its own
errors. The lead is already committed by then, so throwing would abandon the
rest of the page and leave the checkpoint behind, re-polling every later contact
because one send failed. The refused opener is kept as a failed message
(`db/failed-sends.ts`), so the lead's thread shows it with a red "!", and
`openers` in the `poll.tick` line will be lower than `inserted`. *(Until 2026-09-28 it
was not kept, and a lead with no opener showed only as a conversation with no
outbound message.)*

**The opener is rendered before it is sent.** `question_1` in `settings` holds
the copy, including `{first_name}`. `core/messages.ts` substitutes the lead's
first name, or "there" when EZ Texting gave none, and drops the name when
keeping it would push the text past one 160-character segment - a long name
would otherwise cost a second segment on every send. `messages.body` stores the
rendered text, not the template.

**The opener's message id is the link to the reply.** `sendMessage` returns an
id, stored as `messages.ezt_message_id`. An inbound reply carries that same id
in its payload, which is how a reply is tied to the question it answers - see
WEBHOOKS.md.

**Sending is gated on `EZT_SEND_GROUP`.** `sendMessage` throws when it is unset.
The account holds real contacts, so this is the switch that stops a poll from
texting people. The poll group and the send gate are separate settings on
purpose.

**`assertNewestFirst`.** An unrecognised sort field is ignored rather than
rejected, and the default order is oldest-first. If the sort silently broke, the
loop would stop on the first contact every cycle and never ingest anything, with
no error. The guard turns that into a loud failure.

## Who is never texted

Two checks stop a contact being messaged, and both save the lead so the arrival
is still visible:

| Check | What happens |
|---|---|
| EZ Texting has the contact `optOut: true` | Lead saved with a `suppressed` conversation, added to `dnc_list` with reason `ezt_opt_out`, nothing sent |
| The phone is on our `dnc_list`, not released | Lead saved with a `suppressed` conversation, nothing sent |

In practice EZ Texting also removes an opted-out contact from every group, so
the poller usually never sees one at all - observed 2026-09-22, when a number
that texted STOP was struck through and left with no groups. The check is the
second line of defence for a contact that arrives with the flag anyway.

`worker/poller.test.ts` covers both, with EZ Texting and the database mocked.

## Reading the log

```
{"ts":"2026-09-28T23:50:24.426Z","level":"info","event":"poll.tick","svc":"worker","fetched":3,"inserted":1,"skipped":1,"suppressed":0,"openers":1,"ms":352}
```

One JSON line per poll, event `poll.tick` - structured since 2026-09-28,
`LOGGING.md`. The fields:

| | |
|---|---|
| `fetched` | rows returned by the API |
| `inserted` | new leads written |
| `skipped` | examined but not written - already known, or not in the group |
| `suppressed` | opted out; lead written, added to `dnc_list` |
| `openers` | question 1 sent. Lower than `inserted` means a send failed |

These do not have to add up. Contacts below the cutoff stop the cycle and are
never examined, so `fetched` is usually larger than the rest combined. In
steady state `inserted=0` with a small `skipped` is normal and correct.

## Configuration

| | |
|---|---|
| `EZT_GROUP` | Group to read. Required. |
| `EZT_SOURCE` | Defaults to `API`, how partner leads arrive. `WebInterface` for contacts added by hand. |
| `EZT_SEND_GROUP` | Unset means `sendMessage` throws, so no opener goes out. |
| `poll_interval_seconds` | In `settings`, read each tick, so it changes without a restart. |
| `poll_overlap_minutes` | In `settings`. |

## Retrying a failed opener

Built 2026-09-28, Phase 3 task 27 - `worker/retry-openers.ts`, run from the
worker loop beside the poll and the expiry sweep.

**The problem it solves.** When EZ Texting refuses or is unreachable, the poller
records the failure and moves on. Before this, nothing ever tried again: the
lead sat in the database, scored nothing, and was never contacted. That is the
worst failure in the system - a lead the client paid for, silent, with nothing
on any screen to say so.

**How a failed opener is recognised.** The poller sets `expires_at` only once
the opener is accepted, so a conversation still `open` with `expires_at IS NULL`
and no successful outbound message never had one go out. No new column was
needed. The attempt count comes from the failed message rows, so it survives a
restart.

**Only a lead still waiting on question 1 is retried** - on step 1, score 0,
with no message from the lead and no text of ours that went out or may have
(a `sending` row counts). **Only automated failures count as attempts** -
`sent_by IS NULL`. Both from review, 2026-09-28: an agent's own refused texts
used to count, giving a lead up after five minutes; and a lead who replied
anyway could be sent question 1 again, their next answer then scored against
question 2.

**Sent through `db/outbound.ts`**, which writes the row as `sending` before the
send and records EZ Texting's id after. A text that went out is never marked
refused and never retried because a database write after it failed - until
2026-09-28 that case became a "failed" row and the retry sent the opener
again. The poller's own opener and the reply flow use the same helper.

**The backoff,** each wait counted from the *last failed attempt*:

| Attempt | When |
|---|---|
| 1 | The poller's own, as the lead arrives |
| 2 | 5 minutes after attempt 1 failed |
| 3 | 30 minutes after attempt 2 failed |
| 4 | 2 hours after attempt 3 failed |
| 5 | 6 hours after attempt 4 failed |

Then it stops, and logs `opener.gave_up` once. If attempt 1 never happened at
all - no failed row, e.g. `question_1` was missing - the first retry is a
minute after the lead arrived.

**Changed in review, 2026-09-28 - two faults found by testing, not reading:**

- **The waits counted from when the lead arrived.** For a lead already older
  than its schedule every wait had "passed", so all four retries fired on four
  consecutive ticks - four minutes - and a short outage burned them all. The
  branch's own check asserted the extra retry as correct. Every failed attempt
  is a message row with a `created_at` set by the database, so the wait now
  counts from the newest one.
- **Nothing stopped a late first question.** A lead whose opener failed three
  days ago was texted as soon as EZ Texting answered - and on the first deploy,
  every lead whose opener never went out would have been, however old. A lead
  more than **24 hours** old is now never sent a first question (`tooOld` in
  the pass's stats). The full schedule finishes about nine hours after the first
  failure, so the cap only ever catches a lead that was never retried. EZ Texting being down is usually minutes, not seconds, and a
lead whose opener is an hour late is still worth having - but past the last
attempt the failure is not transient, and an endless queue of doomed sends would
bury a real outage in noise. The lead keeps its failed rows, so an agent opening
it sees the red "!" and can text by hand.

**Three things it must never do,** all proved by
`scripts/retry-openers-live-check.ts` against a real database:

- **Text a blocked number.** A live `dnc_list` row excludes the lead from the
  query, and `sendMessage` checks again anyway. A retry loop is exactly where a
  forgotten opt-out check would text someone who said STOP.
- **Send a second opener.** A lead whose opener succeeded has `expires_at` set
  and a non-failed outbound row, so it is never picked up. Texting a lead twice
  is worse than not retrying at all.
- **Send a first question days late.** A lead more than 24 hours old is left
  alone - see "Changed in review" above.

Oldest lead first: they have been silent the longest.

## The other two failures in task 27

**EZ Texting unreachable mid-poll** was already safe and stays as it is: the
checkpoint advances only when the whole cycle succeeds, so a throw leaves it
untouched and the next tick re-covers the same ground. Nothing is lost; the
leads simply arrive a minute later.

**Duplicate webhooks** were already handled - `WEBHOOKS.md`. EZ Texting retries,
and the `(from_number, received_at)` unique index with `ON CONFLICT DO NOTHING`
makes the second delivery a no-op that still answers 200, so the retries stop.

## Not done yet

**Returning leads are dropped.** A phone we already hold is skipped by
`ON CONFLICT (phone) DO NOTHING`. *(2026-09-19: a future item, not
Week 2 - CLAUDE.md §10, "Future: repeat leads". The decided rules are in
STATE-MACHINE.md, "A number that comes back".)*

What the poller has to change: instead of skipping a known phone, look up its
newest conversation and apply those rules, keeping `leads.phone` unique and
adding a conversation to the existing lead.

**What it depends on, unverified:** whether a lead re-delivered by the partner
reaches EZ Texting as a new contact, with a new `createdAt`, or only updates the
existing contact. It cannot be the first: EZ Texting does not allow two
contacts with the same number (verified 2026-09-19, EZTEXTING-API.md). What is
still unchecked is whether updating the existing contact resets `createdAt`. The poller finds contacts by `createdAt` newer than its
checkpoint, so if a re-delivery leaves `createdAt` unchanged, the poller never
sees it and none of the rules ever run. This can be checked on the test account:
add a contact through the API that already exists in the group, and see whether
its `createdAt` moves.

**No page cap.** A checkpoint set far in the past would walk the whole group in
one cycle - 178 requests for a 1,773-contact group, thousands for the full
account. Harmless at 50-100 leads a day, but unbounded.
