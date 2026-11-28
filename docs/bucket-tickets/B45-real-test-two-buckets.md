# B45 · Every path on the test account

**Goal:** every path of Part 1 is walked for real - on the EZ Texting test account with
two groups and on the dev number - before production.

**Why:** the e2e stubs EZ Texting, Twilio and OpenAI at their edges; T26 and A34 found
what only real phones show.

**Depends on:** B43 · **Size:** M · **Status:** To do · **Deploy note:** none.

## Build

A checklist in this ticket, each line ticked with its date and what was seen, on the
test account (groups `weightloss` and a second test group) and the dev number,
(480) 530-8582 - **never production's** (CLAUDE.md):

- a new contact texted and moved to "- taken";
- the same phone added to the second group while the first is open - held, the tag,
  picked up;
- after the first finishes, the second starts; closed as Sold - starts; as Wrong
  number - nothing;
- the switch-over on a test group holding old contacts - nobody texted;
- a call per bucket: antibiotics' robot script with its Seri off; the second bucket
  only through Seri, with its own link and voicemail; Seri failing on it - the goodbye
  line and the lead first in the agents' queue;
- a missed call per bucket - the line and the text;
- Seri on for one bucket only - her calls with that pack; the other on the script;
- the texts, robot and Seri switches, from Admin;
- a STOP in one bucket blocks both.

## Done when

- [ ] Every line ticked with its date; anything wrong becomes its own fix on its own
      branch, linked here.

## Tests

The checklist.

## Docs to update in the same commit

This ticket; `docs/BUCKETS.md` (what was heard).

## Not in this ticket

Production (B46).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
