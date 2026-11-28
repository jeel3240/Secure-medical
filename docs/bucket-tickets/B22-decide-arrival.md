# B22 · Who an arrival is

**Goal:** one pure function decides what happens when a person arrives in a bucket,
covering every case in `BUCKETS.md` and the decisions of 2026-11-27.

**Why:** the rules are spread over three tables in `BUCKETS.md` ("Active in one bucket
at a time", "A closed lead joins a new bucket", "Switching a bucket on") and Jeel's
decisions 2, 5 and 6. One tested function, not SQL, decides - so every case is proved
in unit tests and the transaction (B23) only acts.

**Depends on:** B04, B19 · **Size:** S · **Status:** To do · **Deploy note:** none -
pure code.

## Build

`backend/src/core/arrivals.ts` (new): `decideArrival(facts): ArrivalDecision`, no I/O.

- **Facts** (gathered by B23): a new person or not; the number blocked now, or the
  contact opted out in EZ Texting; this bucket's newest conversation and its status;
  another bucket's open conversation (and whether it is past its expiry); an agent
  holding the person; an open callback; a review conversation; the newest
  disposition, its `value` and `reason`; whether that disposition's conversation is the
  newest.
- **Decision:** `result` (`started`, `held`, `blocked`, `wrong_number`, `mid_flow`),
  and what to do - create the lead, start a conversation, start it suppressed, block
  the number, nothing.
- **Precedence**, top first:
  1. blocked or opted out, or the person's newest conversation is `suppressed` -
     `blocked` (`STATE-MACHINE.md`, "A number that comes back": a suppressed number
     gets nothing, ever). A new person: lead plus a suppressed conversation, as
     today. Known: an arrival only, and the number blocked if the contact opted out
     and no live block exists;
  2. the newest Closed is a wrong number - `reason = 'wrong_number'`, or the retired
     value `wrong_number` - `wrong_number`, an arrival only;
  3. this bucket's conversation still open and not past its expiry - `mid_flow`;
  4. active: another bucket's questions open and not past expiry, an agent holding
     the person, an open callback, or a review conversation (decision 2) - `held`,
     an arrival only;
  5. otherwise `started` - a new conversation. That includes a Closed as sold, not
     interested or with no reason (decision 5), a finished or expired earlier bucket,
     and an open conversation already past its expiry (B23 expires it first).
- An existing person who is held, blocked, a wrong number or mid-flow **never** gets a
  conversation row: the reply flow and the screens read the newest conversation, and a
  placeholder would capture the first bucket's replies.

## Done when

- [ ] `src/core/arrivals.test.ts`: one test per row of each `BUCKETS.md` table and per
      decision - new; new and blocked; known, opted out, unblocked; newest conversation
      suppressed; wrong number (new
      reason and retired value); mid-flow; held for each kind of "active"; open but past
      expiry; closed sold, not interested, no reason; finished; expired; the precedence
      when several hold.
- [ ] Every branch covered (Jest coverage for the file, in *As built*).

## Tests

Unit tests only - the function is pure.

## Docs to update in the same commit

`docs/BUCKETS.md` (the tables point at `decideArrival`), `docs/STATE-MACHINE.md` ("A
number that comes back": now decided by `decideArrival`; a review conversation now
holds a returning person rather than restarting them - decision 2).

## Not in this ticket

Reading the facts and acting on them (B23).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
