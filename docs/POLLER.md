# Poller

Pulls new leads out of EZ Texting into `leads`, and sends each its first
question. It runs in the worker process, one cycle at a time, waiting
`poll_interval_seconds` (30) after each cycle ends before the next. The code is
`backend/src/worker/poller.ts` and the loop `backend/src/worker/index.ts`;
sending question 1 is `backend/src/worker/opener.ts`, shared with the opener
retry. The EZ Texting behaviour it depends on is in `EZTEXTING-API.md`.

## How it works

### The worker cycle

One cycle does up to five things, in this order, each in its own try/catch so
that a failure in one never stops the others:

1. **This poll** - "A cycle", below.
2. **The expiry sweep** (`worker/expiry.ts`). Expiring is local work that must
   keep happening while EZ Texting is unreachable; its rules are
   `STATE-MACHINE.md`, "Expiry".
3. **The retry of first questions that never went out**
   (`worker/retry-openers.ts`) - "Retrying a failed opener", below.
4. **Fetching call transcripts** (`worker/transcripts.ts`, `TWILIO.md`,
   "Recordings and transcripts").
5. **The robot's calls** (`worker/auto-calls.ts`), only with automated calls on
   (`AUTO_CALLS`) and calling set up - `AUTO-CALLS.md`, "When a lead is called".
   It runs last, so a slow poll delays it in the same cycle. With Seri, the AI
   agent, switched on, it first asks whether she can take calls - OpenAI
   answering, checked at most once a minute, and her last calls not all falling
   back (`AI-AGENT.md` section 6).

Then the worker reads `poll_interval_seconds` again - each time, so a change
takes effect without a restart - and waits that long. **Every call to EZ
Texting gives up after 30 seconds**, so one hung connection cannot stall the
cycle. **One cycle runs at a time, however many workers run**: each holds a
Postgres advisory lock (`withTryLock`, `db/locks.ts` - the dialler's own lock is
built on it). A second worker on the same database, started by mistake, skips
its cycle and says so once (`worker.another_running`) rather than polling and
retrying beside the first. The lock is the session's, so a worker that dies lets
it go with its connection.

What the poller owns of expiry is setting `expires_at` and `question_sent_at`
when the first question goes out (`worker/opener.ts`); the second is what lets
the lead's first reply count as an answer (`STATE-MACHINE.md`, rule 2c).

### Why polling

EZ Texting does not tell us when a contact appears, so we ask. There is no date
filter on the contacts endpoint either - `EZTEXTING-API.md`, where every
plausible spelling was tried - so we cannot ask for "contacts since X". Instead
we ask for the group sorted newest-first and stop reading at the first contact
we have already seen: the checkpoint does on our side what a date filter would
have done on theirs.

A new contact can take a while to show: EZ Texting lists one some time after
creating it, and the next poll can be a whole interval away. Nothing on our side
shortens the first; the interval sets the second. The overlap means a contact
that shows up late is not missed, only picked up a round later - **as long as it
shows up within the overlap**, 5 minutes after its `createdAt` (Not done).

### A cycle

1. Read `ezt_poll_checkpoint` from `settings`. Absent, or not a time, means
   look back one hour.
2. Subtract `poll_overlap_minutes` to get the cutoff - 5 when the setting is
   missing, not a number, or not above 0 (`overlapMinutes`): with none, a
   contact listed a moment late would never be taken in.
3. Request page 0 of the group (`EZT_GROUP`, from `EZT_SOURCE`),
   `sort=createdAt,desc`, 50 a page.
4. Walk the page. Stop the whole cycle at the first contact at or older than
   the cutoff - everything below it is older still.
5. For each contact above the cutoff:
   - confirm it is really in the group, by exact name against `groups[]`;
   - normalise the phone to E.164;
   - if `optOut`, or the phone is on `dnc_list`: insert the lead with a
     `suppressed` conversation, and - when EZ Texting has it opted out and we
     hold no live block for it - block the number ("Who is never texted");
   - otherwise insert the lead with an `open` conversation on its flow's first
     question (`startConversation`, `db/flows.ts`), then send that question and
     record it as an outbound message.
6. If the page was not the last, request the next one.
7. Write the checkpoint: the newest `createdAt` actually seen, or - when nothing
   new arrived - the same value again. Every successful poll writes it, so
   `settings.updated_at` is the time of the last poll, which the health check
   and Admin > Leads read.

### Why each piece is there

**The 5-minute overlap** deliberately re-reads contacts already handled, in
case one becomes visible slightly after its `createdAt`. Re-reading is free
because the insert dedupes. It covers a delay of up to 5 minutes, no more: the
poll stops at the first contact older than the cutoff.

**`ON CONFLICT (phone) DO NOTHING`.** The API has no per-contact id, so phone is
the only stable identity. This is what stops a restart from duplicating every
lead, and what makes the overlap safe.

**The group re-check.** The `groupName` filter is a `like` match - it also
matches "weightloss - sent" - so membership is checked against `groups[]`
rather than trusted from the filter.

**The checkpoint is written last, and only on success.** A throw anywhere leaves
it untouched, so the next cycle covers the same ground again rather than
skipping it; EZ Texting unreachable mid-poll loses nothing - the leads arrive a
poll later.

**A failed first question does not fail the cycle.** `openLead` catches every
error from `sendOpener`. The lead is committed by then, so throwing would
abandon the rest of the page and leave the checkpoint behind, re-polling every
later contact because one send failed. The refused text is kept as a failed
message (`db/outbound.ts`), so the lead's thread shows it with a red "!", and
`openers` in the `poll.tick` line is lower than `inserted`.

**The first question is rendered before it is sent.** It is the first question
of the flow new leads get (`openingQuestion`, `db/flows.ts`; `FLOWS.md`), which
holds the copy, `{first_name}` included. `core/messages.ts` puts in the lead's
first name, or "there" when EZ Texting gave none, and drops the name when
keeping it would push the text past one 160-character segment - a long name
would otherwise cost a second segment on every send. `messages.body` stores the
rendered text, not the template.

**Its message id is the link to the reply.** `sendMessage` returns an id,
stored as `messages.ezt_message_id`; an inbound reply carries that id in its
payload, which is how a reply is tied to the text it answers (`WEBHOOKS.md`).

**Sending is gated on `EZT_SEND_GROUP`.** `sendMessage` throws when it is unset:
it is the switch that stops a poll from texting people. The poll group and the
send gate are separate settings on purpose (`ENVIRONMENT.md`).

**`assertNewestFirst`.** An unrecognised sort field is ignored rather than
refused, and the default order is oldest-first. If the sort silently broke, the
loop would stop on the first contact every cycle and never take anything in,
with no error. The guard turns that into a loud failure, with nothing written.

### Who is never texted

Two checks stop a contact being messaged, and both save the lead, so the arrival
is still visible:

| Check | What happens |
|---|---|
| EZ Texting has the contact `optOut: true` | Saved with a `suppressed` conversation; blocked with reason `ezt_opt_out` unless we already hold a live block for it; nothing sent |
| The phone is on our `dnc_list`, not released | Saved with a `suppressed` conversation; nothing sent |

The block goes through `blockNumber` (`db/dnc.ts`) like every other - every
path, its reason and what a block does are in `AGENT-WORKSPACE.md`, "Blocking a
number" - inside the lead's transaction, so the lead, its suppressed conversation, the block and its
`dnc.blocked` record commit together. So a number released by START that EZ
Texting then delivers opted out is blocked again, the record keeping what the
row said before; and a number we already hold a live block for is left exactly
as it is - its own reason stands, and nothing is recorded because nothing
changed.

In practice EZ Texting removes an opted-out contact from every group, so the
poller usually never sees one at all; the check is the second line of defence
for a contact that arrives with the flag anyway.

### Reading the log

```
{"ts":"2026-09-28T23:50:24.426Z","level":"info","event":"poll.tick","svc":"worker","fetched":3,"inserted":1,"skipped":1,"suppressed":0,"openers":1,"ms":352}
```

One JSON line per poll, event `poll.tick` (`LOGGING.md`):

| Field | |
|---|---|
| `fetched` | Rows returned by the API |
| `inserted` | New leads written |
| `skipped` | Examined but not written - already known, or not in the group |
| `suppressed` | Opted out at EZ Texting, or already on `dnc_list`: lead written, nothing sent, blocked if it was not already |
| `openers` | Question 1 sent. Lower than `inserted` means a send failed |

These need not add up. Contacts below the cutoff stop the cycle and are never
examined, so `fetched` is usually larger than the rest together. In steady
state `inserted=0` with a small `skipped` is normal.

### Retrying a failed opener

`worker/retry-openers.ts`, step 3 of the cycle. When EZ Texting refuses or is
unreachable, the poller records the failure and moves on; without a retry the
lead would sit in the database, scored nothing, never contacted - the worst
failure in the system: a lead the client paid for, silent, with nothing on any
screen to say so.

**Which leads** - `db/openers-never-sent.ts`, one definition shared with the
resend below: a conversation still `open` with `expires_at IS NULL` never had a
first question go out, since `sendOpener` sets it only once one does - no
column needed. On top: still on its flow's first question, score 0, no message
from the lead, and no text of ours that went out or may have (a `sending` row
counts). **Only automated failures count as attempts** (`sent_by IS NULL`),
read from the failed message rows, so the count survives a restart. The text
after a missed call is an automated row too: it cannot reach a lead still
waiting on question 1 in normal use - a lead rings us back after an agent has
called - but if it did, a sent one would count as a text of ours that went out
and end the retries, and a refused one would count as an attempt. Oldest lead
first: they have been silent the longest.

**Sent through `db/outbound.ts`** (`sendOpener`), which writes the row as
`sending` before the send and records EZ Texting's id after, so a text that went
out is never marked refused and retried because a database write after it
failed. The poller's own first question, the reply flow and the missed-call text
use the same helper.

**The backoff**, each wait counted from the *last failed attempt*:

| Attempt | When |
|---|---|
| 1 | The poller's own, as the lead arrives |
| 2 | 5 minutes after attempt 1 failed |
| 3 | 30 minutes after attempt 2 failed |
| 4 | 2 hours after attempt 3 failed |
| 5 | 6 hours after attempt 4 failed |

Then it stops and logs `opener.gave_up` once. If attempt 1 never happened at
all - no failed row - the first retry is a minute after the lead arrived. A lead
more than **24 hours** old is never sent a first question by the retry (`tooOld`
in its stats); the full schedule ends about nine hours after the first failure,
so the cap only catches a lead that was never retried. EZ Texting being down is
usually minutes, and a first question an hour late is still worth sending - but
past the last attempt the failure is not passing, and an endless queue of doomed
sends would bury a real outage in noise. The lead keeps its failed rows, so an
agent opening it sees the red "!" and can text by hand.

**Three things it must never do**, all proved by
`scripts/retry-openers-live-check.ts`:

- **Text a blocked number.** A live `dnc_list` row keeps the lead out of the
  query, and `sendMessage` checks again anyway - a retry loop is exactly where a
  forgotten opt-out check would text someone who said STOP.
- **Send a second first question.** A lead whose first question went out has
  `expires_at` set and a non-failed outbound row, so it is never picked up.
  Texting a lead twice is worse than not retrying at all.
- **Send a first question days late** - except when a person decides to, after
  an outage: "Resending after an outage", below.

### Resending after an outage

`npm run openers:send-waiting` (`worker/send-waiting-openers.ts`, its arguments
in `core/resend-args.ts`) sends the first question, by hand, to leads an EZ
Texting outage left without one. The retry's "never a day late" is right for
something that runs by itself, on every lead, with nobody watching; asking those
leads anyway, days later, is a decision a person makes after looking at the
list. When and how to run it is in `DEPLOY.md`, "Resending after an outage".

**Which leads.** The retry's own definition (`db/openers-never-sent.ts`) - still
on the first question, nothing answered, no reply, no text of ours that went out
or may have, not blocked - and on top:

- **only leads the retry has given up on** - attempts used up, or past its day
  (`retryGaveUp`). A lead the retry may still send to is the retry's, so the two
  never text the same lead;
- **only leads that arrived in the window given** (`--from`, `--to`);
- **only leads nobody has worked**: not picked up, and no call, outcome,
  callback, note or text of an agent's. Days later, a lead a person has dealt
  with must not get an automated first question.

A lead whose conversation expired before a first text went out is listed apart
and never sent to: its conversation is over.

**How it sends.**

- **One text at a time, 30 seconds apart** by default (`--every`, never under
  10). A few hundred of the same text back to back is how a sender gets screened
  by the carriers.
- **Checked again just before each text**, so a lead who replies, is blocked or
  is picked up while it runs is skipped.
- **It stops at the first text EZ Texting refuses or does not answer** - one
  refusal after an outage most likely means more. Run again, it carries on: a
  lead already sent to no longer matches, so nothing is sent twice, and a text
  EZ Texting did not answer in time may have gone out and is never sent again.
- **One run at a time** - an advisory lock; a second run is refused.
- **Ctrl+C is safe.** A text in flight is recorded as possibly sent, and the
  lock goes with the connection.

It prints to the terminal and logs nothing of its own. Each text it sends is a
`messages` row, as for every automated text (`AUDIT.md`), sent the same way as
the retry's: rendered from the lead's flow, the reply window opened once it goes
out.

## Rules

1. **The checkpoint moves only after a whole cycle succeeds**, and every
   successful poll writes it.
2. **One cycle at a time**, whatever runs it - the advisory lock.
3. **A failed first question never fails the cycle**; it is kept as a failed
   message.
4. **Never a blocked number, never a second first question, never one more
   than 24 hours late by itself** - only a person, through the resend, sends one
   later.
5. **No text without `EZT_SEND_GROUP`.**
6. **A page not newest-first stops the poll**, with nothing written.

## Data

Writes `leads` (`ON CONFLICT (phone) DO NOTHING`), its first `conversations`
row (`startConversation`), the first question's `messages` row
(`db/outbound.ts`), and blocks through `db/dnc.ts` (`dnc_list` and its
`dnc.blocked` activity row). Reads and writes `settings`:
`ezt_poll_checkpoint`, `poll_interval_seconds` (read every cycle), and
`poll_overlap_minutes` - their seeds and fallbacks are in `SCHEMA.md`, "`settings`
rows". The variables it reads - `EZT_GROUP`, `EZT_SOURCE`, `EZT_SEND_GROUP` - are
in `ENVIRONMENT.md`.

## Code

| File | What it does |
|---|---|
| `backend/src/worker/index.ts` | The loop: the cycle's five tasks under `withTryLock`, then the wait |
| `backend/src/worker/poller.ts` | `pollOnce`, `insertLead`, `openLead`, `overlapMinutes`, `assertNewestFirst` |
| `backend/src/worker/opener.ts` | `sendOpener` - the first question, recorded, its reply window opened |
| `backend/src/worker/retry-openers.ts` | `retryFailedOpeners`, `retryGaveUp` - the backoff and the 24-hour cap |
| `backend/src/db/openers-never-sent.ts` | `findOpenersNeverSent` - which leads never got their first question |
| `backend/src/worker/send-waiting-openers.ts` | The resend after an outage |
| `backend/src/core/resend-args.ts` | Its arguments, pure |
| `backend/src/cli/send-waiting-openers.ts` | Its command |
| `backend/src/integrations/ezt-client.ts` | `listContacts`, `isInGroup`, `toE164`, `sendMessage` - 30-second timeouts |
| `backend/src/db/sql.ts` | `pollIntervalSeconds`, `DEFAULT_POLL_INTERVAL_SECONDS` |
| `backend/src/db/locks.ts` | `withTryLock` |

## Tests

| What | Where |
|---|---|
| Opted-out and blocked contacts saved suppressed and never texted; a new contact opened; a known phone or one outside the group skipped; a failed, refused, timed-out or blocked first question; the checkpoint - not advanced on a failure, written on a quiet poll, the cutoff, paging, an oldest-first page refused, a missing or unreadable checkpoint, the overlap from its own setting | `backend/src/worker/poller.test.ts` |
| The real poll for an opted-out contact, one released by START, one already blocked - the block and its record | `backend/scripts/activity-live-check.ts` |
| The backoff and the three must-nots | `backend/scripts/retry-openers-live-check.ts` |
| The resend: the leads it takes and those it must not, never twice across runs, the pace, stopping and carrying on, a lead that changes while it runs, one run at a time | `backend/scripts/send-waiting-openers-live-check.ts` |
| The resend's arguments | `backend/src/core/resend-args.test.ts` |
| A contact added, polled and asked its first question | `backend/scripts/end-to-end.ts` |

## Not done

- **A returning lead is never seen.** A number already on the account cannot be
  added as a second contact: a re-delivery updates the existing one - the new
  group added beside the old - and `createdAt` stays as it was, with no
  `updatedAt` either (`EZTEXTING-API.md`, "One contact per phone number"). A
  return shows only in the contact's `groups[]`, so the poller, which finds
  contacts by `createdAt`, cannot find one by date - and a phone we already hold
  is skipped by `ON CONFLICT (phone) DO NOTHING` in any case. The same holds for
  a contact added to a second group. Phase 8 plans the way round it: two groups
  per bucket, and a conversation added to the existing lead (`BUCKETS.md`,
  "Finding people: two groups per bucket"; `STATE-MACHINE.md`, "A number that
  comes back").
- **A contact that shows up more than 5 minutes after its `createdAt` is never
  taken in** - one EZ Texting lists late, or one added to the group by hand more
  than 5 minutes after it was created: by the time it is seen it is older than
  the cutoff. `BUCKETS.md`'s two groups fix this too.
- **No page cap.** A checkpoint set far in the past would walk the whole group
  in one cycle - 36 requests for a 1,773-contact group at 50 a page, far more for
  the whole account. Harmless at 50-100 leads a day, but unbounded.

## Decisions

| Decision | By | Date |
|---|---|---|
| Poll every 30 seconds, not 60 (migration 005) | Jeel | 2026-09-29 |
| A quiet poll still writes the checkpoint, so its time says the worker polled | Jeel | 2026-09-28 |
| The opener retry counts each wait from the last failed attempt, and never sends a first question more than 24 hours after the lead arrived | Jeel | 2026-09-28 |
| The poller's block goes through `db/dnc.ts`, like every other | Jeel | 2026-10-01 |
| A first question days late is sent only by hand, after a person has looked at the list - not by changing the retry | Jeel | 2026-10-16 |

## History

- 2026-11-27 · Rewritten to the area template: the cycle's five tasks (it said
  four), the wait after each cycle (it said every 30 seconds); the repeat-lead
  check answered - `createdAt` does not move on a return; the resend's running
  steps moved to `DEPLOY.md`; the production run and task 27's other two
  failures moved here; the first sketch, from `EZTEXTING-API.md`, to History ·
  `docs/DOCS.md` · D16, D12
- 2026-11-23 · `worker/poller.test.ts` reads the checkpoint and the overlap as
  two settings - before, its stub answered every key alike, so neither was ever
  tested; the late-contact gap written down · review Q6, R12
- 2026-11-22 · One cycle at a time, under an advisory lock: a second worker on
  the same database polled and retried beside the first, and sent a retried
  first question twice; `poll_overlap_minutes` read as 5 when it is not above 0 -
  with none, a contact listed a moment late was never taken in · review M14, M16
- 2026-11-12 · With Seri on, the robot's calls first ask whether she can take
  calls · A17
- 2026-10-24 · The robot's calls, the cycle's fifth task, last and on their own
  · T20
- 2026-10-16 · The resend after an outage built: from 2026-10-14 EZ Texting
  blocked the account for two days and every first text failed. The retry did
  what it should - five attempts in about nine hours, then nothing, and nothing
  for a lead more than a day old - so when the account came back the leads of
  those two days had never been asked anything, and never would be. Run on
  production the day EZ Texting unblocked the account: the dry run listed 174
  leads, each with five failed attempts, in two batches - Oct 14, 3:23-5:32 AM,
  and Oct 15, 3:00-5:51 AM, Arizona time; the partner delivers in the early
  morning, and none arrived after the client paused them on Oct 15. None had
  expired. The list was checked, then sent one every 30 seconds - about 87
  minutes. Gaps in the lead ids between the batches are normal: every poll
  re-reads the last few minutes, and an insert that finds the phone held still
  uses up an id · T0
- 2026-10-06 · Every call to EZ Texting gives up after 30 seconds: without a
  limit one hung connection stopped all four tasks the cycle then had, with
  nothing in the logs · review of Phase 5
- 2026-10-05 · The first question read from the flow's first question
  (`FLOWS.md`) - it was `question_1` in `settings` · Phase 5
- 2026-10-02 · Call transcripts fetched in the cycle, its fourth task
  (`TWILIO.md`, "Recordings and transcripts") · Phase 4
- 2026-10-01 · The poller's block through `db/dnc.ts`. It had its own insert,
  `ON CONFLICT DO NOTHING`, the one block that left no record (`AUDIT.md`), and
  a number released by START stayed unblocked when EZ Texting delivered it opted
  out again · Phase 4
- 2026-09-29 · Every 30 seconds, not 60, migration 005: a test with a real lead
  took 108 seconds from adding the contact in EZ Texting to question 1 going
  out - that contact was not listed 47 seconds in, and was 107 seconds in - and
  halving the interval halves the wait for the next check
- 2026-09-28 · Structured log lines (`LOGGING.md`); every successful poll writes
  the checkpoint - before, a quiet account left it standing still, and the
  health check and Admin > Leads reported a healthy worker as stopped; a refused
  first question kept as a failed message - before, a lead with no first
  question showed only as a conversation with no outbound message;
  `worker/opener.ts` shared by the poller and the retry, which each had their
  own copy; every automated send recorded around the send - before, a failed
  write after a send became a "failed" row and the retry sent the first question
  again. The retry built (Phase 3 task 27), and two faults found in its review by
  testing, not reading: the waits counted from the lead's arrival, so for a lead
  older than its schedule every wait had "passed" and all four retries fired on
  four consecutive ticks - four minutes, a short outage burning them all, and
  the branch's own check asserted the extra retry as correct; and nothing
  stopped a late first question - a lead whose first question failed three days
  before was texted as soon as EZ Texting answered, and on the first deploy every
  lead whose first question never went out would have been, however old. Also
  in review: an agent's own refused texts counted as attempts, giving a lead up
  after five minutes, and a lead who replied anyway could be sent question 1
  again, their next answer scored against question 2. Task 27's other two
  failures needed nothing: EZ Texting unreachable mid-poll was already safe -
  the checkpoint moves only when the whole cycle succeeds - and duplicate
  webhooks were already handled by the `(from_number, received_at)` unique
  index (`WEBHOOKS.md`) · Phase 3
- 2026-09-22 · EZ Texting seen removing an opted-out contact from every group: a
  number that texted STOP was struck through and left with no groups; the
  expiry sweep added to the cycle (`STATE-MACHINE.md`)
- 2026-09-19 · Verified: EZ Texting does not allow two contacts with the same
  number (`EZTEXTING-API.md`). Repeat leads made a future item, not Week 2
  (CLAUDE.md §10, "Future: repeat leads"); the decided rules were in
  `STATE-MACHINE.md`. The plan was to look up a known phone's newest
  conversation and apply those rules instead of skipping it, keeping
  `leads.phone` unique and adding a conversation to the existing lead, once a
  check showed whether a re-delivery moves `createdAt` - add, through the API,
  a contact that already exists in the group and see. Checked 2026-11-27: it
  does not
- 2026-09-10 · The poller first sketched, in `EZTEXTING-API.md`, before it was
  built: every 45 s, the checkpoint (now minus an hour at first), pages of
  `GET /v1/contacts?filters[groupName][like]=weightloss&filters[source][eq]=API&sort=createdAt,desc&size=50`
  read down to the checkpoint minus 5 minutes, the group checked by exact name,
  an opted-out contact saved `suppressed` with a `dnc_list` row, a new lead
  given an `open` conversation at step 1 and a `send_opener` job, the checkpoint
  set to the newest `createdAt` seen - never advanced on an error, one poller
  only, fetched, inserted, skipped and the time logged each tick. Built
  differently: the interval from `settings` (30 s since migration 005), no job
  queue - the first question
  sent in the same cycle - the group and source from `EZT_GROUP` and
  `EZT_SOURCE`, a phone already on `dnc_list` saved suppressed too, the
  conversation on the active flow's first question, and the checkpoint written
  on every successful poll · Phase 1
