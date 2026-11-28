# B16 · Readers per conversation

**Goal:** what a robot call did is read against its own conversation, so the first
bucket's call can never stop, or show up as, the second bucket's.

**Why:** survey and review, 2026-11-27:

- `phoneTookOverAtSql` and `phoneStoppedQuestionsAtSql` (`backend/src/db/lead-state.ts`)
  count robot answers and Seri's turns from **any** call of the lead after the
  conversation began - a late answer on the first bucket's call could stop the second
  bucket's questions (rule 2d);
- Admin > Leads' Call column and its `?call=` filter (`robotCallSql`,
  `backend/src/db/leads.ts`) read the lead's newest robot call, whatever its
  conversation - the new bucket's row would show the old bucket's result.

**Depends on:** B15 · **Size:** S · **Status:** To do · **Deploy note:** none.

## Build

- `phoneTookOverAtSql` / `phoneStoppedQuestionsAtSql`: robot answers and Seri's turns
  only from calls whose `conversation_id` is that conversation. A lead **calling us**
  stays lead-wide: it is the person on the phone, whatever the bucket.
- `robotCallSql` and the Call filter: the newest robot call of the newest
  conversation; "none" when that conversation has had none.
- `backend/src/db/timeline.ts`: a robot call names its bucket.
- Stays lead-wide, and the code says so in a comment: a stop on a call blocks the
  number and suppresses **every** open conversation (`saveOutcome`,
  `db/auto-calls.ts`); a missed "yes" (`MISSED_YES_SQL`) is still owed to the person.

## Done when

- [ ] `scripts/agent-sms-live-check.ts` (rule 2d): an answer on the first
      conversation's call after the second began does not stop the second; an incoming
      call still does.
- [ ] `scripts/admin-leads-live-check.ts`: the Call column and filter follow the newest
      conversation; "none" for a new conversation with no call yet.
- [ ] `scripts/timeline-live-check.ts`: a robot call names its bucket.

## Tests

The three live checks.

## Docs to update in the same commit

`docs/STATE-MACHINE.md` (rule 2d), `docs/ADMIN-LEADS.md` (the Call column),
`docs/AUTO-CALLS.md`, `docs/BUCKETS.md`.

## Not in this ticket

The dialler (B17).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
