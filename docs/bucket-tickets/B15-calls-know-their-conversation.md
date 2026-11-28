# B15 · Calls know their conversation

**Goal:** every automated call records which conversation - and so which bucket - it
was placed for.

**Why:** a call stores only `lead_id` (survey, 2026-11-27); nothing ties it to a
conversation, a flow, a bucket or a script. B16, B17, B18 and B40 all need that link.

**Depends on:** B03, B07 · **Size:** S · **Status:** To do · **Deploy note:** the code
writes a column its migration adds - outside the robot's hours until B02 is in.

## Build

- **Migration** (the next free number):
  - `calls.conversation_id INTEGER REFERENCES conversations(id)`, with an index;
  - backfill: each automated call gets its lead's newest conversation created at or
    before the call's `started_at`. A guard: it stops unless every automated call got
    one;
  - a named check: an automated call has a conversation. Agent and incoming calls may
    have none - a call to or from a person is about the person, not one bucket;
  - a unique index, one automated call per conversation, keeping the `not_placed`
    exception of `calls_one_automated_per_lead` - **beside** that index, which stays
    until B17.
- `backend/src/db/auto-dial.ts`, `leadsToCall` and `stillDue`: return the
  conversation's id with the lead.
- `backend/src/db/auto-calls.ts`, `startAutomatedCall(leadId, conversationId)`: writes
  it; `backend/src/worker/place-auto-call.ts` passes it.

## Done when

- [ ] `scripts/auto-calls-live-check.ts`: a placed call carries its conversation; an
      automated call with none refused (named); a second automated call on one
      conversation refused; every existing case unchanged.
- [ ] `scripts/calls-upgrade-check.ts` (B03): automated calls seeded on leads with one
      and two conversations get the right one; agent and incoming calls stay empty.
- [ ] `src/worker/place-auto-call.test.ts`: the conversation is passed through.

## Tests

The live check, the upgrade check, the unit test.

## Docs to update in the same commit

`docs/SCHEMA.md` (`calls`), `CLAUDE.md` §5, `docs/WORKFLOW.md`, `docs/AUTO-CALLS.md`
("How a call is placed"), `docs/BUCKETS.md`.

## Not in this ticket

Reading the link (B16-B18); dropping the per-lead index (B17).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
