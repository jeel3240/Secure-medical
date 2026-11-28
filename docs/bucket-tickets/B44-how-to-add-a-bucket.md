# B44 · How to add a bucket

**Goal:** a written, tested way to add a bucket - the order, the migration, the pack,
the switches - so the second bucket (B47-B49) and every one after it is routine.

**Why:** Part 3's screens are later; until then a bucket is added by a reviewed change,
as flows are (`docs/FLOWS.md`, "How to add one").

**Depends on:** B43 · **Size:** S · **Status:** To do · **Deploy note:** none -
docs.

## Build

A section in `docs/BUCKETS.md`, "How to add a bucket", in order:

1. The content from the client - the checklist in "What each new bucket needs".
2. A migration: the bucket row; its flow, questions and choices, the best answers
   reaching 100 (`FLOWS.md`); its missed-call text and line; its call lines - voicemail, link, stop (B50); no robot
   script; everything off. A commented SQL skeleton beside it,
   copied from the test bucket of B43.
3. Its EZ Texting group set on each environment - the command from B21.
4. Its Seri pack: a folder, the campaign, answers, products and playbook, its eval
   cases; registered; `knowledge_key` set in a migration.
5. The checks before each switch: texts - a test contact on the test account; Seri -
   her evals pass, then calls on the dev number.
6. The switches, one at a time, on Admin > Configuration: texts, then Seri and calls
   together - a bucket with no robot script calls only through her.

## Done when

- [ ] The section reviewed against the test bucket: every step it names exists and
      works.
- [ ] `docs/FLOWS.md` and `docs/AI-AGENT.md` point to it.

## Tests

None - a document, checked against B43's test bucket.

## Docs to update in the same commit

`docs/BUCKETS.md`, `docs/FLOWS.md`, `docs/AI-AGENT.md`, `docs/README.md` (the doc
table's "update when" for `BUCKETS.md`).

## Not in this ticket

The second bucket itself (B47-B49).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
