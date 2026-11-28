# Phase 7 tickets: Seri, the AI agent

The build of `docs/AI-AGENT.md`, split into small tickets. Each is one PR into `dev`, with its tests and docs in the same commit. Read the design first, then the ticket.

**How to work a ticket:** read the ticket and the files it names; build only what is under *Build*; tick every *Done when*; leave *Not in this ticket* alone. What was built differently from the ticket goes under *As built* in the ticket, and in the design.

## The rules every ticket keeps

- **Production keeps working.** With her switch off - or no `OPENAI_API_KEY` - nothing changes: the script takes every robot call and OpenAI is never asked (`docs/AI-AGENT.md`, "Rules").
- **All AI code lives in `backend/src/ai/`**, apart from the hooks `docs/AI-AGENT.md`, "Code", lists.
- **The database in order:** migrations 022, 023 and 024 are this phase's; a change to a table is a new migration, never an edit (`docs/WORKFLOW.md`).
- **Only our own phones:** every real call on the dev number, (480) 530-8582 - outside production the robot rings only `AUTO_CALL_TEST_NUMBERS`.
- **Her words are never in the logs** - only in `call_ai_turns`.
- **The gates:** backend and frontend `npm test`, the live checks and `npm run e2e`; a change to what she knows or how she speaks also runs the understand and speak test sets and the replays (`docs/AI-BRAIN.md`, "Tests").

## The tickets

S is a few hours, M about a day, L two days or more. L predates the docs standard (`docs/DOCS.md` allows S and M only); A11, A27 and A30 were sized so, and are done. The *Depends on* column decides what can start.

| # | Ticket | Depends on | Size | Status |
|---|---|---|---|---|
| | **Foundations, the brain of the first build, and the relay** | | | |
| A01 | [Setup: packages, OpenAI key, on/off switch](A01-setup-packages-openai-key-on-off-switch.md) | - | S | Done 2026-11-11 - the key and the switch, each change recorded as `ai_agent.switched` |
| A02 | [Spike: first test call with ConversationRelay](A02-spike-first-test-call-with-conversationr.md) | A01 | S | Done 2026-11-12 - test calls on the dev number: her voice picked, the relay's ground confirmed |
| A03 | [Knowledge loader](A03-knowledge-loader.md) | - | S | Done 2026-11-11 - a broken file stops the api starting |
| A04 | [Seri's instructions (system prompt)](A04-seri-s-instructions-system-prompt.md) | A03 | M | Done 2026-11-11 - `buildInstructions` removed 2026-11-19 with the one-request brain; `instructions.ts` keeps the call's own details |
| A05 | [Sentence safety check](A05-sentence-safety-check.md) | A03 | S | Done 2026-11-11 - `checkSentence`; every line of the knowledge files passes |
| A06 | [Seri's five actions](A06-seri-s-five-actions.md) | A07 | S | Done 2026-11-11 - the actions as OpenAI tools removed 2026-11-19; `toHandoff` guards the new brain's action |
| A07 | [Call-back time rules](A07-call-back-time-rules.md) | - | S | Done 2026-11-11 - `callback-time.ts`, pure |
| A08 | [Migration 022](A08-migration-022.md) | - | S | Done 2026-11-11 - its rules proved by `ai-agent-live-check` |
| A09 | [Answer test set](A09-answer-test-set.md) | A04, A05, A06 | M | Done 2026-11-11 - chose `gpt-4.1-mini`; removed 2026-11-19 with the brain it tested |
| A10 | [Relay part 1: connection and storage](A10-relay-part-1-connection-and-storage.md) | A01, A08 | M | Done 2026-11-12 - refused unless Twilio signed it; every turn kept |
| A11 | [Relay part 2: Seri talks (OpenAI)](A11-relay-part-2-seri-talks-openai.md) | A04, A05, A06, A10 | L | Done 2026-11-12 - streamed a sentence at a time, each checked; the stop check first |
| A12 | [Relay part 3: limits and failures](A12-relay-part-3-limits-and-failures.md) | A11 | M | Done 2026-11-12 - silence, the three minutes, OpenAI slow or failing |
| | **Into the call** | | | |
| A13 | [The call goes to Seri](A13-the-call-goes-to-seri.md) | A01, A10 | S | Done 2026-11-12 - `/auto/answer` connects an answered call to her |
| A14 | [After Seri: carrying out her action](A14-after-seri-carrying-out-her-action.md) | A06, A13 | M | Done 2026-11-12 - `/auto/ai-after`, or the script when she failed |
| A15 | [Seri books a call back](A15-seri-books-a-call-back.md) | A07, A08, A14 | S | Done 2026-11-12 - saved with her result, migration 023 |
| A16 | [Seri's call backs in the queue](A16-seri-s-call-backs-in-the-queue.md) | A15 | M | Done 2026-11-12 - due, first in the queue; taken on pick-up |
| A17 | [OpenAI checked before calling](A17-openai-checked-before-calling.md) | A12 | S | Done 2026-11-12 - nothing placed while OpenAI is down, or after three fallbacks |
| A18 | [Voicemail and hang-ups while Seri talks](A18-voicemail-and-hang-ups-while-seri-talks.md) | A14 | S | Done 2026-11-12 - the beep decides; her goodbye waits for the verdict |
| A19 | [Seri's conversation on the timeline](A19-seri-s-conversation-on-the-timeline.md) | A10 | S | Done 2026-11-12 - under the call on the lead's timeline |
| A20 | [End-to-end and live checks](A20-end-to-end-and-live-checks.md) | A13, A14, A15, A16, A17, A18, A19 | M | Done 2026-11-12 - `npm run e2e` runs her calls ending each way |
| A21 | [Every path on a real phone](A21-every-path-on-a-real-phone.md) | A20 | M | Dropped 2026-11-17 - paused after call 112 for the new brain, and walked again on it as A34 |
| | **The new brain - understand, decide, speak** (Jeel, 2026-11-17: `docs/AI-BRAIN.md`) | | | |
| A24 | [Measure, then decide](A24-measure-then-decide.md) | - | S | Done 2026-11-17 - two steps: understand `gpt-5.4-mini`, speak `gpt-4.1-mini` |
| A25 | [Small fixes that carry over](A25-small-fixes-that-carry-over.md) | A24 | S | Done 2026-11-17 - silence held, not started again; the specialist line by who is there |
| A26 | [Knowledge: ids and offer tags](A26-knowledge-ids-and-offer-tags.md) | A24 | S | Done 2026-11-17 - knowledge `approved-2026-11-17` |
| A27 | [The policy: the call's record, and what Seri does next](A27-policy.md) | A26 | L | Done 2026-11-17 - built and tested alone; used by the call from A30 |
| A28 | [Understand: what the lead just said](A28-understand.md) | A24, A26, A27 | M | Done 2026-11-17 - 94.5%, every stop, wrong person and wanting a person right |
| A29 | [Speak: her words for each move](A29-speak.md) | A27 | M | Done 2026-11-17 - 97.6% over 21 kinds of reply |
| A30 | [The new brain on the call](A30-wired-into-the-call.md) | A25, A27, A28, A29 | L | Done 2026-11-17 - every call uses it; the one-request brain kept for a rollback until 2026-11-19, then removed |
| A31 | [What the new brain keeps, and picking a call back up](A31-storage-and-resume.md) | A30 | M | Done 2026-11-17 - migration 024 |
| A32 | [Whole-call replays](A32-whole-call-replays.md) | A30, A31 | M | Done 2026-11-17 - 238 of 240 replays held every rule |
| A33 | [Listening](A33-listening.md) | A30 | S | Done 2026-11-18 - understanding started early, and Flux's end of turn at 0.6; chosen on A34's calls 118 and 119 |
| A34 | [A21 walked again, on the new brain](A34-a21-walked-again.md) | A30-A32 | M | Done 2026-11-23 - calls 113-140 (2026-11-17 to 2026-11-22): the introduction, questions, talking over, a call back and its refusals, two no's, voicemail, hang-ups, a yes now on every path, no then the link, the objections, a medical question, every stop, a lead with no name, silence, OpenAI failing and down, and switched off; the three minutes left to the tests; call 122's call back on the screens when due, 2026-11-23 |
| | **Live** | | | |
| A22 | [Deploy, then switch on](A22-deploy-then-switch-on.md) | A34 | S | In progress - deployed 2026-11-24 with Seri off (PR #31, migrations 022-024); switching her on is next |
| A23 | [A voicemail menu is never put through](A23-a-voicemail-menu-is-never-put-through.md) | A22 | M | Waits on A22 - after the main AI agent work (Jeel, 2026-11-16); seen on production twice on the script |

**Where the old sections went.** Tickets written before 2026-11-27 point at `docs/AI-AGENT.md`'s sections as they were then. Section 12, the brain, is now `docs/AI-BRAIN.md`; the relay's settings, the TwiML, Twilio's messages and her tones - "What the first test calls showed", "The settings A13 starts from", "Her voice and tone" - are `docs/AI-RELAY.md`; section 5 is `docs/AI-KNOWLEDGE.md`; sections 8 and 9 are `docs/AI-AGENT.md`'s "Tests" and "Data", 10 and 11 its "Not done". The "Changed after A21's call N" notes are under A21's *As built*, section 12's "After call N" notes under A34's, and "What the first test calls showed" under A02's.

## The order

Tickets with nothing in *Depends on* can start any time. The path taken:

1. **Foundations:** A01, A03, A08, then A02 (first test call, pick the voice)
2. **Seri's brain, pure and tested:** A04, A05, A07, A06, then A09 (test set, choose the model)
3. **The relay:** A10, A11, A12
4. **Into the call:** A13, A14, A15, A16, A17, A18, A19
5. **Prove it:** A20, A21 (paused after call 112, then dropped for A34)
6. **The new brain:** A24 (measure), A25, A26, A27, A28, A29, A30, A31, A32, A33, then A34 - A21's checklist again
7. **Live:** A22
8. **After it:** A23

## Waiting on

| What | Blocks |
|---|---|
| Jeel: her card on Admin > Configuration seen saying Off with the key set, then Seri switched on in the calling hours and the first real calls watched | A22 |
| A22 done - the main AI agent work first (Jeel, 2026-11-16) | A23 |

## The decisions these tickets build on

The design's decisions - ConversationRelay with an OpenAI text model and an ElevenLabs voice, the AI running the whole call with the script as its backup, her five actions, call backs at a time the lead picks, the knowledge as three files, the limits and the fallback, the rollout - are in `docs/AI-AGENT.md`, "Decisions"; the new brain's - three steps, the two models, the saved introduction, the one-request brain removed - in `docs/AI-BRAIN.md`, "Decisions". Each was Jeel's, or the client's where it says so.
