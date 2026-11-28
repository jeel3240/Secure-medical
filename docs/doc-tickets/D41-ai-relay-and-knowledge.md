# D41 · AI-RELAY.md and AI-KNOWLEDGE.md

**Goal:** The relay's settings, Twilio's message shapes, the TwiML, the tones and the timings in `AI-RELAY.md`; what she knows - the files, what a call reads, the versions - in `AI-KNOWLEDGE.md`. Both references.

**Why:** The settings block shows Rachel's voice; the code has Aria, `partialPrompts` and an end of turn at 0.6 (`ai/relay-messages.ts`) (audit, 2026-11-27).

**Depends on:** D40 · **Size:** S · **Status:** Done 2026-11-27 - `docs/AI-RELAY.md` and `docs/AI-KNOWLEDGE.md`, both pass `--type reference` · **Deploy note:** none - documentation only.

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

- `docs/AI-RELAY.md`: today's `RELAY_SETTINGS` (Aria, `partialPrompts`, `eotThreshold` 0.6) attribute by attribute, the TwiML as `seriTwiml` writes it, who may connect and the close codes, every message each way, how a session ends and Twilio's reconnect, the seven tones, the notes kept as turns, the timings measured on the dev number.
- `docs/AI-KNOWLEDGE.md`: the three files, what a call reads and what is kept only for people, the rules the files keep and the loader's checks, every version, where the words came from, the crawl.
- Counts checked against the files: 10 rules, 37 answers (36 approved, `medical_web` open), 30 products (7, 4, 1, 18), 9 objections; 353 area codes in `callback-time.ts`; 186 products and 576 pages in the crawl. Corrected: the loader does not check an answer's `note` or a product's `site_price_usd`, and only objection ids are held to the id pattern.
- Onboarding of the Twilio account handed to `TWILIO-SETUP.md`.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
