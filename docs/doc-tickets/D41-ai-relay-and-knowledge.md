# D41 · AI-RELAY.md and AI-KNOWLEDGE.md

**Goal:** The relay's settings, Twilio's message shapes, the TwiML, the tones and the timings in `AI-RELAY.md`; what she knows - the files, what a call reads, the versions - in `AI-KNOWLEDGE.md`. Both references.

**Why:** The settings block shows Rachel's voice; the code has Aria, `partialPrompts` and an end of turn at 0.6 (`ai/relay-messages.ts`) (audit, 2026-11-27).

**Depends on:** D40 · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- the settings block replaced by today's `RELAY_SETTINGS`; the knowledge counts checked against the files (10 rules, 37 answers, 30 products, 9 objections).

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

`docs/README.md`, `AI-AGENT.md`.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
