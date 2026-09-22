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
7. Write the checkpoint to the newest `createdAt` actually seen.

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
because one send failed. A lead with no opener shows as a conversation with no
outbound message, and `openers` in the tick log will be lower than `inserted`.

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
poll tick fetched=3 inserted=1 skipped=1 suppressed=0 openers=1 ms=352
```

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
