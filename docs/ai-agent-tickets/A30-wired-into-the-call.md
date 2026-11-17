# A30 · The new brain on the call

**Goal:** a call to Seri runs on understand, decide and speak, with everything the call does today still working: stops, the safety check, "One moment...", the fallback, the three minutes, silence, being talked over, the voicemail verdict.

**Depends on:** A25, A27, A28, A29  ·  **Size:** L  ·  **Status:** To do

## Build

`conversation.ts`:

- Understand and who is there asked at the same time; then the policy; then the approved answer and Speak.
- **The commit point:** the lead's acts change the record only when her first sentence goes out. New words before then stop the run and start it again on everything unanswered; each run numbered, a late answer dropped.
- Talked over: a move counts as said only if its first sentence is in what Twilio says the lead heard.
- One deadline from the lead's words: "One moment..." at 4 s, the script at 8 s; understand slower than about 2.5 s - Speak answers that turn alone, briefly, with no offer and no action.
- The three minutes set the wrap-up in the record; the hard stops stay.
- Actions from the policy through the existing checks as guards (`checkCallbackTime`, `saysClock`, no transfer with nobody); a check that trips is logged (`ai_policy.guard`) and a safe move used.
- Removed: `leadTurn` and its notes, the actions as OpenAI tools, the written-action path.
- If A24 or A33 choose it: understand started on Flux's early end-of-turn (`partialPrompts`) and reused when the final words match.

## Done when

- [ ] `conversation.test.ts` and `relay.test.ts` rewritten and passing for each behaviour above; every backend test, lint and tsc.

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 1 ("How a reply is made"), 3, 6 and 12, `LOGGING.md`, this tracker, `CLAUDE.md`.
