# B12 · Timeline: arrivals and every conversation

**Goal:** a lead's timeline shows each time they arrived in a bucket, and the markers
of every conversation - not only the newest.

**Why:** `backend/src/db/timeline.ts`'s `systemEvents` builds "Lead received from X",
"scored", "agent took over", "phone took over" and "expired" from the **newest**
conversation only. With buckets, the first bucket's score and expiry would vanish from
the history the moment the second starts - and nothing may be lost from view.

**Depends on:** B09 · **Size:** S · **Status:** To do · **Deploy note:** none.

## Build

- `db/timeline.ts`:
  - one event per arrival, from `bucket_arrivals`, replacing `lead_received`:
    "Arrived in Antibiotics · API"; a held arrival "Arrived in Weight loss · held -
    active in Antibiotics"; blocked, wrong number and mid-flow arrivals worded plainly;
  - the scored, agent-took-over, phone-took-over and expired markers for **every**
    conversation, each naming its bucket (its flow's).
- `frontend/src/components/Timeline.tsx`, `systemText`: the new wordings, short, in
  the timeline's existing style (no sentences shouted, no capitals).
- `frontend/src/pages/LeadTimelinePage.tsx`, `summarise`: unchanged unless a count it
  shows depends on the newest conversation only - then it says which.

## Done when

- [ ] `scripts/timeline-live-check.ts`: a lead with two conversations in two buckets -
      both arrivals, both scored markers, the first one's expired marker, in time
      order; a held arrival; a lead with no arrival still shows "received" from
      `created_at`.
- [ ] `frontend/src/components/Timeline.test.tsx`: each new wording.

## Tests

The live check; the frontend unit test.

## Docs to update in the same commit

`docs/AGENT-WORKSPACE.md` (the timeline's events), `docs/FRONTEND.md`,
`docs/BUCKETS.md`.

## Not in this ticket

Messages grouped by conversation - texts stay one thread, the arrivals mark where each
bucket began; the bucket badges in the header (B30).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
