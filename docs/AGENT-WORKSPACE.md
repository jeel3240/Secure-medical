# Agent workspace API

The endpoints behind the Agent Workspace, the Lead Timeline and My Callbacks -
`DESIGN-PROMPT.md` sections 3, 4 and 5. Phase 3.

**Built so far: claim and release** (task 2, 2026-09-26) - `api/leads.ts` and
`db/claims.ts`. Everything else here is still the contract to build against: no
route touches `notes`, `dispositions` or `callbacks`, and nothing marks a lead
read. Paths and payload shapes for the unbuilt ones are proposed, not agreed -
say so if you want them different; everything under "Rules" is decided.

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
is what brings an expired lead who texted back into the queue, and today nothing
clears it, so the lead never leaves. This is the missing half.

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
| `GET` | `/api/leads/:id` | Lead card: name, phone, source, age, score, tier, answers, score breakdown, flags (DNC, needs review, unread). Marks the lead read. |
| `GET` | `/api/leads/:id/timeline` | Every event for the lead, oldest first: system, outbound SMS, inbound reply, agent SMS, call, note, callback, disposition. |
| `POST` | `/api/leads/:id/claim` | Claims it. 409 `already_claimed` with the holder's name when someone else has it. |
| `POST` | `/api/leads/:id/release` | Releases your own claim. A superadmin may release anyone's. |
| `POST` | `/api/leads/:id/notes` | `{ body }`. |
| `POST` | `/api/leads/:id/messages` | `{ body }` - agent SMS. Sets the take-over timestamp. Refused on a DNC lead. |
| `POST` | `/api/leads/:id/dispositions` | `{ value }` from the seven in `DESIGN-PROMPT.md` section 3. `DNC` also blocks the number. |
| `POST` | `/api/leads/:id/callbacks` | `{ scheduledAt, agentId? }` - defaults to you; a superadmin may assign another agent. |
| `PATCH` | `/api/callbacks/:id` | `{ scheduledAt }` to reschedule, or `{ done: true }` to complete. |
| `GET` | `/api/callbacks?when=today\|upcoming\|overdue&agentId=` | My Callbacks. `agentId` is superadmin only. |

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

System events are not a table. "Lead received from CORE-G-27", "Scored 100 · HOT
· queued" and "Conversation expired" are derived from the lead and its
conversation rather than logged rows, so the timeline has to synthesise them.
Deciding which ones are worth showing is part of building it.

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
- **Answer chips** (`Interest: Both`) and the score breakdown need the choice
  numbers mapped to words. The words live in the question copy in `settings`,
  which is admin-editable in principle, so the mapping belongs in one place
  rather than hard-coded in the screen.
