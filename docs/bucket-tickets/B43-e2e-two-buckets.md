# B43 · A test bucket and the e2e across two buckets

**Goal:** `npm run e2e` runs the whole app with two buckets - driving the **real**
poller - and proves a person's path across both.

**Why:** the e2e never runs the poller today; it inserts leads itself (survey,
2026-11-27). Phase 8's risk is in the joins between pieces - intake, holding, the
queue, the robot's script, Seri's pack - so they are proved together, as T25 and A20
did for their phases.

**Depends on:** the gate in the tracker (B18, B28, B33, B34), B40 · **Size:** M ·
**Status:** To do · **Deploy note:** none - test code.

## Build

- A test bucket, seeded by the e2e in its own database only: its flow, call script,
  missed-call text and line, groups, and a test knowledge pack (registered in code
  under a key no production bucket uses).
- EZ Texting stubbed at its HTTP edge for the group reads and moves as well as sends
  (today only `axios.post` is stubbed), so the real `pollOnce` runs.
- New steps, each with `check`s:
  1. Dana arrives in antibiotics - taken in, texted antibiotics' question 1, moved;
  2. Dana added to the test bucket while antibiotics is open - held, **Needs review ·
     2 buckets** in the queue; an agent picks her up - "Working"; nothing texted for
     the test bucket;
  3. Sam arrives in the test bucket - its question 1; no reply - the robot calls with
     the test bucket's script; a "no" then the link - the test bucket's link text;
  4. Sam calls back and nobody answers - the test bucket's missed-call line and text;
  5. Seri on for the test bucket only - Sam's next call goes to her with the test
     pack; antibiotics' calls stay on the script;
  6. a lead closed as Sold in antibiotics arrives in the test bucket - its questions
     start; one closed as Wrong number - nothing.
- The "Not proved" line updated.

## Done when

- [ ] `npm run e2e` passes, every new check counted - the total in *As built*.
- [ ] Each new step fails when the ticket it proves is reverted locally (seen once per
      step).

## Tests

The e2e itself.

## Docs to update in the same commit

`docs/README.md` ("How to test": what the e2e covers), `docs/BUCKETS.md`.

## Not in this ticket

Real phones (B45).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
