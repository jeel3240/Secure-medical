# D43 · AI-AGENT.md, what remains

**Goal:** `AI-AGENT.md` is about 400 lines in the Area template: the call around Seri - answer, relay, after; who is there; her five actions; call backs; limits and fallback; the line dropping.

**Why:** "The seven decisions" has 8 rows; "about 3,500 words of instructions" describes the removed brain; "22 tickets" (34); two live-check counts disagree; `Caddyfile` for `caddy/Caddyfile` (audit, 2026-11-27).

**Depends on:** D40, D41, D42 · **Size:** M · **Status:** Done 2026-11-27 - `docs/AI-AGENT.md` 887 lines to 355, passes `--type area` but for `DEPLOY.md`, not yet written · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History, with a Status line in the fixed words;
- the stale points fixed; the "Build tracker" section dropped (the tracker is the tracker); repeated facts linked (`AUTO-CALLS.md`, `QUEUE.md`, `CALLBACKS.md`, `STATE-MACHINE.md`, `SCHEMA.md`, `AUDIT.md`, `DEPLOY.md`); the code comments naming removed code (`ai/actions.ts`, `ai/openai.ts`) corrected.

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

- Rewritten to the Area template with a Status line in the fixed words (`In progress`); sections 1-7 kept as numbered `###` headings, so the code comments quoting them still resolve; 8 became Tests, 9 Data, 10 and 11 Not done; "The seven decisions" (eight rows) and the inline decisions in Decisions; the "Build tracker" section dropped.
- Fixed: the removed brain's lines (her 3,500-word instructions, the actions as OpenAI tools, the notes); "22 tickets" (34); the two live-check counts dropped; `Caddyfile` to `caddy/Caddyfile`; the button's wording ("Switch on" / "Switch off" on the Seri card).
- Linked, not restated: the voicemail rule (`AUTO-CALL-SCRIPT.md`), the transfer and who is free (`AUTO-CALL-TRANSFER.md`), the queue (`QUEUE.md`), her call backs' booking and pick-up (`CALLBACKS.md`), her fold on the timeline (`TIMELINE.md`), rule 2d, columns, actions, the key (`ENVIRONMENT.md`), the commands (`DEPLOY.md`, handed off).
- The stale comments naming removed code taken out of `backend/src/ai/actions.ts` (`ACTION_TOOLS`, `writtenAction`) and `backend/src/ai/openai.ts` (`openAiModel`); nothing else in those files changed.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
