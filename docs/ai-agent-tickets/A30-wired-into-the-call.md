# A30 · The new brain on the call

**Goal:** a call to Seri runs on understand, decide and speak, with everything the call does today still working: stops, the safety check, "One moment...", the fallback, the three minutes, silence, being talked over, the voicemail verdict.

**Depends on:** A25, A27, A28, A29 · **Size:** L · **Status:** Done 2026-11-17 - every call uses it; the one-request brain kept for a rollback until 2026-11-19, then removed

## Build

`conversation.ts`:

- Understand and who is there asked at the same time; then the policy; then the approved answer and Speak. *(As built: who is there first, then understand - `docs/AI-AGENT.md` section 12, "As built: the brain on the call".)*
- **The commit point:** the lead's acts change the record only when her first sentence goes out. New words before then stop the run and start it again on everything unanswered; each run numbered, a late answer dropped.
- Talked over: a move counts as said only if its first sentence is in what Twilio says the lead heard.
- One deadline from the lead's words: "One moment..." at 4 s, the script at 8 s; understand slower than about 2.5 s - Speak answers that turn alone, briefly, with no offer and no action.
- The three minutes set the wrap-up in the record; the hard stops stay.
- Actions from the policy through the existing checks as guards (`checkCallbackTime`, `saysClock`, no transfer with nobody); a check that trips is logged (`ai_policy.guard`) and a safe move used.
- Removed: `leadTurn` and its notes, the actions as OpenAI tools, the written-action path.
- If A24 or A33 choose it: understand started on Flux's early end-of-turn (`partialPrompts`) and reused when the final words match.

## Done when

- [x] Every behaviour above tested in `brain.test.ts` (13), on the real conversation with OpenAI faked; `conversation.test.ts` and `relay.test.ts` unchanged and passing - the call around the brain did not change; 1,878 backend tests, lint, tsc.

## As built

`docs/AI-AGENT.md` section 12, "As built: the brain on the call (A30)". Built differently from the ticket, more simply:

- **The brain sits behind the call's existing `SeriModel`**, rather than `conversation.ts` being rewritten: it reads the history the call already keeps - what the lead heard of each reply, trimmed by the call when she is talked over - so the commit point, late results and moves counted only when heard come from the call's own machinery, and every behaviour of A11-A21 stays as tested. `conversation.ts` is unchanged.
- **Today's brain is kept for a rollback** - the relay's `model`; taking out the `brain` line in `api/index.ts` brings it back - until A34 passes; then it is removed with `leadTurn`'s notes, the actions as OpenAI tools, the whole-call instructions and `npm run ai:eval` (A09), whose lead lines are already in A28's labelled set. *Removed 2026-11-19 with today's brain: `docs/AI-AGENT.md` section 12, "Today's brain removed".*
- **Not done:** understand on Flux's early end of turn - A33. One deadline for both steps: the call's 4 s / 8 s already counts from the lead's words to the first word, both steps inside it.
- **Found while testing:** a test file that does not compile is not run, and the total of tests passing does not show it - "Test Suites" must be read too (it was the health test, fixed).

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 1 ("How a reply is made"), 3, 6 and 12, `LOGGING.md`, this tracker, `CLAUDE.md`.
