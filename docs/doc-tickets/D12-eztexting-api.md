# D12 · EZTEXTING-API.md

**Goal:** `EZTEXTING-API.md` is a reference: endpoints, filters, field map, webhook fields, and findings (finding · evidence · date).

**Why:** It says "every 45s" and "enqueue job"; calls the `createdAt` question unchecked beside the check's result; tells you to use your own trial account beside the update saying otherwise (audit, 2026-11-27).

**Depends on:** D01 · **Size:** S · **Status:** Done 2026-11-27 - a reference - endpoints, filters, field map, webhook fields, findings with evidence and date; the docs check passes but for `RUNNING.md` · **Deploy note:** none - documentation only.

## Build

- the tables above; the poller sketch to `POLLER.md`; STOP's effects and dedupe to `STATE-MACHINE.md`/`WEBHOOKS.md`; the account's safety rules owned here, linked from CLAUDE.md and WORKFLOW; the 2026-11-27 group test as a finding row; History.

## Done when

- [ ] the doc's sections are its type's, in the type's order (`docs/DOCS.md`)
- [ ] no dated note, "As built" or "until" aside left in the body - each is a line in History
- [ ] every fact another doc owns is a link, not a copy
- [ ] every file, function, setting and route it names exists (`grep`)
- [ ] every link resolves, and every code comment that quotes a moved or renamed section is updated
- [ ] nothing lost: each removed sentence is either still true somewhere, or in History

## Tests

The docs check (D47) once it exists; until then `grep` for every name the doc gives, and each link opened.

## Docs to update in the same commit

`docs/README.md`'s table if a doc is added, renamed or its type changes; the tracker's row.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

- Sections: the account's rules (the one owner), endpoints, listing contacts with its filters, one contact, the field map and the groups, sending, the inbound webhook and subscriptions, one contact per phone number with the 2026-11-27 test, STOP handling, Findings (finding · evidence · date), Decisions.
- The stale lines to History: "every 45s" and "enqueue job" (the sketch, handed to `POLLER.md`), the `createdAt` question "unchecked", and "use your own trial account" - the test-account decision of 2026-09-14 is in Decisions. Four findings from the antibiotics flow's real-phone walks merged from the SMS rewrite's handoff.
- STOP's effects and the dedupe now link `STATE-MACHINE.md` and `WEBHOOKS.md`; the subscription and tunnel steps link `RUNNING.md`.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
