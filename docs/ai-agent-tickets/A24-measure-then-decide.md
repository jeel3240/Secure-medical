# A24 · Measure, then decide

**Goal:** the new brain - understand, decide, speak (`docs/AI-AGENT.md` section 12) - is written down, and how fast each way of making a reply is has been measured, so the models and the shape are chosen from numbers, not guesses.

**Why:** the new brain asks OpenAI twice per reply where today it asks once. A reply that starts more than about 0.8 s after the lead stops already feels slow (section 1), and today's, on A21's real calls 86-112, start at 1.09 s median and 2.15 s at the slowest tenth (`call_ai_turns.latency_ms`). The second step must not make that worse.

**Depends on:** - · **Size:** S · **Status:** Done 2026-11-17 - the bake-off script removed 2026-11-19 with the one-request brain, its baseline; its numbers are in `AI-BRAIN.md`, "How fast"

## Build

- Section 12 of `docs/AI-AGENT.md`, the tickets A24-A34 and the tracker.
- `npm run ai:bakeoff` (`backend/scripts/ai-bakeoff.ts`): every lead line - the answer test set's 91 cases, and A21's 103 real lead lines exported from the local database - asked four ways, shuffled together so each meets OpenAI's good and bad minutes alike:
  - today's brain (the whole instructions, the five actions as tools), to the first word or action;
  - a stand-in for **understand** (short prompt, strict JSON labels), to the whole answer;
  - a stand-in for **speak** (her persona and a move brief), to the first word;
  - one call writing labels, move and words as JSON, to the words' first character.
- The models the account has that answer without thinking or with the least: `gpt-4.1-mini` (today), `gpt-4o-mini`, `gpt-5-nano` (minimal), `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-6-luna` (reasoning `none`).
- What Twilio offers for listening, read from its docs: Smart Turn Detection, and Deepgram Flux's own end-of-turn settings.

## Done when

- [x] A table of the times in section 12, and the decision: which model for each step, two steps or one.
- [x] The gate: the two-step first word at a median of at most 1.3 s and a slowest tenth of at most 2.2 s, and no more than 0.3 s over today's brain measured in the same run - the median inside it, the slowest tenth about half a second slower than today (below).

## As built

`docs/AI-AGENT.md` section 12, "How fast". 3,298 requests over 194 lines, 2026-11-17, none failed. OpenAI's own times: today's one request 0.61 s median, 0.81 s at the slowest tenth; understand with `gpt-5.4-mini` 0.71 / 0.87 s; speak with `gpt-4.1-mini` 0.52 / 0.61 s; both one after the other 1.21 / 1.44 s. But on the real lines only 44 of 103 need both: 39 are a bare yes or no (speak alone) and 20 a question with an approved answer (understand alone, the answer said by code) - so 0.75 s median and 1.36 s at the slowest tenth, against today's 0.61 / 0.80 s.

**Decided:** two steps - understand `gpt-5.4-mini` (reasoning `none`), speak `gpt-4.1-mini` - each to be confirmed on quality in A28 and A29. The median is inside the gate; the slowest tenth is about half a second slower than today on turns that need both steps (about 1.9 s on a call, inside 2.2 s) - accepted for decisions made right every time, and A33's early end of turn takes back part of it. The one-request way (0.83 s) stays the fallback.

Two findings for later tickets: **Smart Turn Detection does not apply with Deepgram Flux** - only Nova-3 can try it (A33); and the stand-in's labels missed an act for **asking for the link** ("Just text me the link." came out as a call back) - A28's act list has `wants_link`.

The bake-off is kept, not thrown away as first planned: `npm run ai:bakeoff` measures again after A30 and A33. Real lines are read from a file exported from the local database (`--real`), never committed: they hold a test lead's words. *(Removed 2026-11-19 with today's brain, its baseline: `ai-bakeoff.ts` and `npm run ai:bakeoff` are gone. A33 was measured on A34's real calls instead (calls 118 and 119), and whole calls are replayed with `npm run ai:replay` (A32) - its real lines read the same way.)*

## Not in this ticket

- How well each model understands or speaks - A28 and A29 measure that, on labelled lines; this ticket only rules out the slow ones.

## Docs to update in the same commit

- `docs/AI-AGENT.md` (section 12, the seven decisions, section 8), this tracker, `CLAUDE.md` (the AI row and `scripts/`).
