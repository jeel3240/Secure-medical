# Poller

Pulls new leads out of EZ Texting into `leads`. Runs in the worker process,
one cycle at a time, every 60 seconds.

Code: `backend/src/worker/poller.ts` and `backend/src/worker/index.ts`.
API behaviour it depends on: `docs/EZTEXTING-API.md`.

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
   - otherwise insert the lead with an `open` conversation at step 1
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

**`assertNewestFirst`.** An unrecognised sort field is ignored rather than
rejected, and the default order is oldest-first. If the sort silently broke, the
loop would stop on the first contact every cycle and never ingest anything, with
no error. The guard turns that into a loud failure.

## Reading the log

```
poll tick fetched=3 inserted=1 skipped=1 suppressed=0 ms=352
```

| | |
|---|---|
| `fetched` | rows returned by the API |
| `inserted` | new leads written |
| `skipped` | examined but not written - already known, or not in the group |
| `suppressed` | opted out; lead written, added to `dnc_list` |

These do not have to add up. Contacts below the cutoff stop the cycle and are
never examined, so `fetched` is usually larger than the rest combined. In
steady state `inserted=0` with a small `skipped` is normal and correct.

## Configuration

| | |
|---|---|
| `EZT_GROUP` | Group to read. Required. |
| `EZT_SOURCE` | Defaults to `API`, how partner leads arrive. `WebInterface` for contacts added by hand. |
| `poll_interval_seconds` | In `settings`, read each tick, so it changes without a restart. |
| `poll_overlap_minutes` | In `settings`. |

## Not done yet

**The opener is not sent.** The insert branch has a TODO where
`sendMessage` belongs. Sending is blocked until there is a `dev-test` group -
see WORKFLOW.md.

**Resold leads are dropped.** A phone we already have is skipped. CLAUDE.md
section 6 says it should expire the old conversation and create a new lead
linked by `previous_lead_id`. That is Week 2 work, and it needs
`leads.phone UNIQUE` to go, since the same person would then legitimately
appear twice.

**No page cap.** A checkpoint set far in the past would walk the whole group in
one cycle - 178 requests for a 1,773-contact group, thousands for the full
account. Harmless at 50-100 leads a day, but unbounded.
