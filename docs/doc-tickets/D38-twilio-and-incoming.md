# D38 · TWILIO.md and INCOMING-CALLS.md

**Goal:** `TWILIO.md` covers calls we place, the call bar, voicemail detection, recordings, webhook trust and calls left open; `INCOMING-CALLS.md` covers who rings, a missed call, the card, the ringtone and notifications.

**Why:** 920 lines with 49 dates; a stale ring said to stay open (closed by `callsLeftOpen`, `db/calls.ts`); the identity given without its prefix (`core/calls.ts`); the lead paragraph misses T19's ring to everyone free (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** Done 2026-11-27 - `TWILIO.md` and `INCOMING-CALLS.md` in the Area template; `docs-check --type area` clean but for links to docs still being written · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History, each of the two;
- the three stale points fixed; a Decisions table (ringtone, the card, the recording notice, the call bar, the unknown-caller card, voicemail detection); "What is kept as proof" linked to `AUDIT.md`; prices and consent wording removed - the client's (memory: not ours).

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

`docs/README.md`, every doc and code comment that pointed at moved sections.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

- `TWILIO.md` keeps calls we place, the call bar, voicemail, recordings and the notice, webhook trust and calls left open, each a `###` under How it works with its old name; `INCOMING-CALLS.md` takes who rings, a missed call, the card, rings to several people, the ringtone (Safari's restart a `####` of its old name) and the notification, and `FRONTEND.md`'s incoming-call file table.
- Fixed: the identity is `<prefix>agent-<id>` (`identityFor`); the lead says a lead nobody owns rings everyone free; a ring neither report reaches is closed by `callsLeftOpen`, not left "ringing"; the card's sketch shows today's fields ("Next step", not the first flow's question).
- The notice's words, Twilio's prices and the legal reason for the notice are out - History says so; "What is kept as proof" is a link to `AUDIT.md`; the column meanings handed to `SCHEMA.md`.
- Code comments that quote moved sections are listed for a later pass, not edited here (documentation-only rewrite); two are in migrations that have run and stay as they are.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
