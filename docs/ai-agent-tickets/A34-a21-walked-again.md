# A34 · A21 walked again, on the new brain

**Goal:** every path of A21's checklist heard on a real phone with the new brain, before A22.

**Depends on:** A30-A32  ·  **Size:** M  ·  **Status:** Ready 2026-11-17 - A33's measurements are taken on these calls

## Build

- A21's checklist, on the dev number to our own phones: the greeting (and a lead with no name); a yes now - the lead's own agent first, then everyone, the hold line, nobody; a call back, refused at 8 PM and on a Sunday, then its badge, Admin > Leads, the queue and My Callbacks; no then the link; two no's; every objection; price and medical; talking over her; silence and the three minutes; every stop; voicemail while she talks; hang-ups; OpenAI failing and down; switched off mid-day.

- **A33 on the same calls:** the wait after each of the lead's lines, from `ai_relay.reply` and `ai_brain.turn`, and `eotThreshold` 0.8 against 0.6.
- **The brain's record** of each reply, read after each call: `call_ai_turns` rows `Record of the reply (the brain)` - how the line was understood, the moves.

## Progress

| Call | What happened | Found |
|---|---|---|
| 113 | Nobody free, Monday 4:35 PM: "Yes.", "How much is it?", "Yes. Uh, tomorrow at around two PM, just call me back.", "Yes." | As it should be: the opening once (the "Yes." read without OpenAI); the price, the approved answer word for word, no "connect you"; "tomorrow at around two" worked out by code - "So that's tomorrow at 2 PM your time?" - and booked on the "Yes.": `callback_booked`, Tuesday 2 PM Arizona time, 52 seconds. Understand took 1.5-1.7 s on the line, against 0.9 s in the test set - her replies started 1.0-2.3 s after the lead's words (A33) |
| 114 | Nobody free: "Yes.", then "Wait. How long does shipping take?" said over the opening, "I am not interested.", "I'm not interested.", "I just don't need it." | Talked over: she stopped at once and answered the shipping question. But **the opening was said three times**: cut off before its end, it counted as never said. Fixed on `fix/brain-cut-off-opening` - a reply heard mostly counts whole, the opening once any of it was heard (section 12). After the two no's, a goodbye and nothing more: `not_interested`, 54 seconds. Understand 1.0-1.3 s; replies 1.0-2.1 s |

## Done when

- [ ] Every line heard and noted with its date in `docs/AI-AGENT.md`, like T26; then A22.

## Docs to update in the same commit

- `docs/AI-AGENT.md`, A21's ticket, this tracker.
