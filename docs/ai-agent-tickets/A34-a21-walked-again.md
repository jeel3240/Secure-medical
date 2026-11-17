# A34 · A21 walked again, on the new brain

**Goal:** every path of A21's checklist heard on a real phone with the new brain, before A22.

**Depends on:** A30-A32  ·  **Size:** M  ·  **Status:** Ready 2026-11-17 - A33's measurements are taken on these calls

## Build

- A21's checklist, on the dev number to our own phones: the greeting (and a lead with no name); a yes now - the lead's own agent first, then everyone, the hold line, nobody; a call back, refused at 8 PM and on a Sunday, then its badge, Admin > Leads, the queue and My Callbacks; no then the link; two no's; every objection; price and medical; talking over her; silence and the three minutes; every stop; voicemail while she talks; hang-ups; OpenAI failing and down; switched off mid-day.

- **A33 on the same calls:** the wait after each of the lead's lines, from `ai_relay.reply` and `ai_brain.turn`, and `eotThreshold` 0.8 against 0.6.
- **The brain's record** of each reply, read after each call: `call_ai_turns` rows `Record of the reply (the brain)` - how the line was understood, the moves.

## Done when

- [ ] Every line heard and noted with its date in `docs/AI-AGENT.md`, like T26; then A22.

## Docs to update in the same commit

- `docs/AI-AGENT.md`, A21's ticket, this tracker.
