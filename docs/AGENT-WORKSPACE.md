# Agent workspace API

The endpoints behind the Agent Workspace, the Lead Timeline and My Callbacks -
`DESIGN-PROMPT.md` sections 3, 4 and 5. Phase 3.

**Built so far** (all 2026-09-26): claim and release (task 2), marking a lead
read (task 3), the lead card (task 4), the timeline (task 5) and notes (task 6) -
`api/leads.ts`, `db/claims.ts`, `db/read-flag.ts`, `db/lead-detail.ts`,
`db/timeline.ts`, `db/notes.ts`, `core/score-breakdown.ts`. Everything else here
is still the contract to build against: no route yet writes `dispositions` or
`callbacks`, though the timeline reads both. Paths and payload shapes for the unbuilt ones are
proposed, not agreed - say so if you want them different; everything under
"Rules" is decided.

Every route is under `/api`, requires a session, and is open to any signed-in
user unless it says superadmin. See `AUTH.md`.

## Rules

**One agent at a time.** Claiming sets `assigned_to` and `assigned_at`. A second
agent claiming the same lead gets a 409 and sees the row as "In progress -
{name}" in the queue. Claims never expire - `SCHEMA.md` says why - so a
superadmin can force a release.

**A claim by a deactivated agent does not count.** The queue already ignores it
(`QUEUE.md`); the claim endpoint treats such a lead as free.

**Opening a lead marks it read,** clearing `leads.has_unread_inbound`. That flag
is what brings an expired lead who texted back into the queue, and nothing
cleared it until Phase 3 task 3, so the lead never left.

*Changed 2026-09-26:* the clearing is `POST /api/leads/:id/read`, and the `GET`
does **not** do it. The workspace polls the lead every few seconds, so a `GET`
that cleared the flag would clear it on the first tick whether or not anyone had
read the message - and a list that prefetched detail would mark leads read that
nobody opened. The frontend says when a lead counts as opened.

**An agent SMS stops the automated questions.** It sets the take-over timestamp
on the conversation; from then on replies are stored for the agent and never
scored. STOP and START still work. The rule and the reason are in
`STATE-MACHINE.md`, "An agent has taken the conversation over" - that is the
authority, not this file.

**The DNC disposition blocks the number** for SMS and calls: it writes
`dnc_list` with reason `agent_dnc` and suppresses any open conversation, the
same end state as an SMS STOP. It is the only way a number reaches that list by
hand - there is no manual add screen (Jeel, 2026-09-23). It needs a confirm
dialog, and it cannot be undone from the app.

**Nothing is sent to a blocked number.** `sendMessage` already refuses one, so
the agent SMS box is disabled on a DNC lead rather than failing at send time.

## Endpoints

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/leads/:id` | Lead card: name, phone, source, age, score, tier, answer chips, score breakdown, holder, flags (DNC, needs review, unread, expired). Read-only - see below. |
| `GET` | `/api/leads/:id/timeline` | Every event for the lead, oldest first: system, outbound SMS, inbound reply, agent SMS, call, note, callback, disposition. |
| `POST` | `/api/leads/:id/read` | Clears `has_unread_inbound`. 204, idempotent. |
| `POST` | `/api/leads/:id/claim` | Claims it. 409 `already_claimed` with the holder's name when someone else has it. |
| `POST` | `/api/leads/:id/release` | Releases your own claim. A superadmin may release anyone's. |
| `POST` | `/api/leads/:id/notes` | `{ body }`. |
| `POST` | `/api/leads/:id/messages` | `{ body }` - agent SMS. Sets the take-over timestamp. Refused on a DNC lead. |
| `POST` | `/api/leads/:id/dispositions` | `{ value }` from the seven in `DESIGN-PROMPT.md` section 3. `DNC` also blocks the number. |
| `POST` | `/api/leads/:id/callbacks` | `{ scheduledAt, agentId? }` - defaults to you; a superadmin may assign another agent. |
| `PATCH` | `/api/callbacks/:id` | `{ scheduledAt }` to reschedule, or `{ done: true }` to complete. |
| `GET` | `/api/callbacks?when=today\|upcoming\|overdue&agentId=` | My Callbacks. `agentId` is superadmin only. |

## Notes

`db/notes.ts`, `POST /api/leads/:id/notes`, 201 with the note.

**Append-only.** A note records what an agent thought at a moment and the
timeline shows it in sequence; nothing edits or deletes one. `notes` has no
`updated_at`, which is the schema saying the same thing.

**The author is the session,** never the payload - a body carrying `agentId` is
ignored. **Not restricted to the lead's holder:** a superadmin reviewing a lead
an agent is working may still record what they saw, and a note is evidence
rather than ownership.

The body is trimmed, required, and capped at 5000 characters. The cap exists so
a runaway client cannot fill the column, not to ration what an agent can say.

## How the lead card is built

`db/lead-detail.ts` for the query, `core/score-breakdown.ts` for the words.

**The newest conversation is the card.** A lateral join picks it, the same way
the queue and Admin > Leads do. Earlier ones stay on the lead as history; the
flags follow the newest, so a lead whose old conversation expired but whose new
one is open does not read as expired.

**A released `dnc_list` row does not raise the DNC flag.** The join is
`released_at IS NULL`. A number that opted out and later texted START is
contactable again - migration 002 - and the row is kept only as the record.

**A claim by a deactivated agent is not reported as a holder,** matching the
queue and the claim endpoint. All three have to agree or the card would show a
lead as held by someone who cannot work it.

**The breakdown shows only what was earned.** A lead who stopped after question
1 gets two lines, not five with zeros: the card records what happened rather
than scoring what was possible. A rule missing from `scoring_rules` contributes
nothing instead of throwing, because an admin can delete a row and a lead card
is not the place to fail over it.

`scripts/lead-detail-live-check.ts` proves the parts that live in SQL - which
conversation wins, the released-DNC join, the deactivated holder - against a
real database.

## Marking a lead read

`db/read-flag.ts`, `POST /api/leads/:id/read`. Built as its own endpoint rather
than only as a side effect of `GET /api/leads/:id`, so the frontend decides when
a lead counts as opened - a list that prefetches detail would otherwise silently
mark leads read that nobody looked at. The `GET` may still clear it when that
route lands; both call the same function.

**Idempotent.** Marking an already-read lead read is a 204: the caller wanted it
read and it is. The function reports whether this call was the one that changed
it, which is what a log line keys on.

**Not scoped to the lead's holder.** Reading is not claiming. A superadmin
looking at a lead an agent holds has still read it, and the flag is about
whether a human has seen the message, not about who owns the work.

**What it is for.** An expired conversation is closed, so the only thing keeping
such a lead in the queue is this flag - `db/queue.ts`,
`c.status = 'expired' AND l.has_unread_inbound`. Nothing cleared it before, so
the lead never left. `scripts/read-flag-live-check.ts` proves the effect against
a real database: the lead leaves the queue once read, while one whose
conversation is still open stays, because the flag was never what held it there.

## How claim and release are built

`db/claims.ts`. The whole one-agent-at-a-time rule is the WHERE clause of a
single UPDATE:

```sql
WHERE l.id = $1
  AND (l.assigned_to IS NULL
       OR l.assigned_to = $2
       OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = l.assigned_to AND u.is_active))
```

**One statement, not a read then a write.** Checking whether a lead is free and
then claiming it leaves a gap where both agents see it free. Making the
condition part of the UPDATE means the database decides: the second agent's
statement matches no row and updates nothing. Two agents claiming in the same
millisecond is proved to leave exactly one holder by
`scripts/claims-live-check.ts`.

**Re-claiming a lead you already hold succeeds and leaves `assigned_at`
alone.** Opening a lead twice is not a new claim, and a timestamp that reset on
every open would stop a superadmin spotting one held since last week - which is
the only reason the column exists.

**A claim by a deactivated agent is treated as free,** matching the queue, which
already ignores it. If the two disagreed, a lead would appear free in the list
and refuse to be taken.

Status codes: 409 `already_claimed` when an active agent holds it - the caller
did nothing wrong, someone was first - and 403 `not_yours` when an agent tries
to release a claim that is not theirs. Releasing a lead nobody holds succeeds:
the caller wanted it free, and it is.

## The timeline

One merged, ordered list assembled from `messages`, `calls`, `notes`,
`callbacks` and `dispositions`, each entry carrying a `kind`, a timestamp, an
author where there is one, and its own fields. The screen decides the icons and
wording, the way it does for queue tags.

System events are not a table. They are derived from the lead and its
conversation rather than logged rows, so the timeline synthesises them.

**Built 2026-09-26**, `db/timeline.ts`. Four system events, each standing on a
timestamp that actually exists:

| Event | Placed at | Why there |
|---|---|---|
| `lead_received` | `ezt_added_at` | Its own timestamp. Carries the source. |
| `scored` | The last inbound reply | Nothing records when a score was reached. `updated_at` moves on every change, so it cannot be used; the last reply is what earned the final points. |
| `agent_took_over` | `agent_took_over_at` | Migration 003. |
| `conversation_expired` | `expires_at`, only when the status is `expired` | `expires_at` is set on every send, so a live conversation always has a future one that has not happened. |

An event with no timestamp to stand on is left out rather than guessed at.

**Ordering.** Oldest first, and ties are common enough to matter: `scored`
shares a timestamp with the reply that earned it, and `lead_received` shares one
with the opener it triggered. Within the same instant the order is
received → inbound → SMS → call → note → callback → disposition → other system
events, so the story reads in the sequence it happened.

**Three kinds come out of `messages`.** An inbound row is a reply; an outbound
row with `sent_by` null is one of ours; an outbound row with an agent is their
manual message. Nothing writes `sent_by` until task 9, so every outbound row is
automated today and the split is ready for when that changes.

`getTimeline` returns null for a lead that does not exist, so the route can tell
that apart from a lead with no history - both would otherwise be an empty list.
`scripts/timeline-live-check.ts` proves the merge, the ordering and the derived
events against a real database.

## What it needs that does not exist

- **A migration** for the take-over timestamp on `conversations`. Nothing else
  needs a schema change: `notes`, `dispositions` and `callbacks` are already
  there and unused.
- **`dnc_list.reason` gains `agent_dnc`.** `SCHEMA.md` predicted this.
- **A `sent_by` value for agent SMS.** `messages.sent_by` exists; outbound
  automated messages leave it null today.

## Known gaps in the screens

- **State** and **Consent ref** on the lead card and timeline sidebar have no
  data. EZ Texting sends neither - `EZTEXTING-API.md`. They cannot be filled.
- **Seen before** and the timeline's "Previous lead" section need repeat-lead
  handling, still blocked - CLAUDE.md §10, "Future".
- **The Call button** is built disabled until Phase 4.
- ~~**Answer chips** and the score breakdown need the choice numbers mapped to
  words.~~ *Done 2026-09-26, `core/score-breakdown.ts`.* The words come from
  `scoring_rules.label` - `Q1: Both` with the prefix stripped - not from the
  question copy in `settings`. The labels already pair each choice with the
  points it earns, so one row answers both "what did they say" and "what was it
  worth"; the question copy is prose written for a lead to read and free to be
  reworded. The prefix convention is now something code relies on, and
  `answerLabel` leaves a label without one alone rather than dropping it.
