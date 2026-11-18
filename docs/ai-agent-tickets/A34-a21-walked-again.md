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
| 115 | The same, after the fix: "Wait. How long does shipping take?" over the opening, "No. I'm not interested.", "No. I just don't need it." | As it should be: the opening once - cut off at "...25% off your first", never said again; the shipping answer; the why asked once; then "Thanks for your time today, Jeel. Goodbye." - `not_interested`, 38 seconds. Replies 1.0-2.0 s |
| 116 | Meant for voicemail, picked up by mistake, hung up after the opening | `hung_up`, 11 seconds - as it should be |
| 117 | Declined on the iPhone: its voicemail greeting | As it should be: she said nothing over the greeting; Twilio's verdict `machine`, the beep took the call and left the voicemail message - `voicemail_left`, 29 seconds. The relay logged `ai_relay.model_failed` ("Request was aborted.") as the call closed - not OpenAI failing; fixed on `fix/closed-call-not-a-model-failure`, the call closing is not a failure |
| 118 | Nobody free, with the head start (A33): "Yes.", "How much is it?", "How long does shipping take?", "Do you ship to Texas?", then "No. I don't understand." (meant as a no), "I'm not interested.", "I just don't need it.", "No. Thank you." | As it should be: the opening once; the price, shipping and states answers word for word; the lead talking over her twice, she stopped each time; the unclear line taken for neither yes nor no - the offer asked again; the why asked, other products offered once, then a goodbye after the second no: `not_interested`, 93 seconds. Softer: after the states answer she said the same again in her own words ("Absolutely, we ship nationwide including Texas"). Speed unchanged - replies 0.8-2.3 s, one 5.4 s with "One moment..."; A33 has the numbers |
| 119 | Nobody free, Flux's end of turn at 0.6 (A33): "Yes.", "How much is it?", "How long does... shipping take?" with a pause on purpose, "And do you ship to Texas?", "Uh, no. I am not, uh, interested.", "No. I just don't need it.", then hung up during the offer | The pause: one turn, she did not cut in; a little faster to the ear - 0.6 kept. **Misheard:** "shipping take" reached us as "sitting tech", so she gave the licensed-provider answer - Twilio's transcription, not the pause. One word alone after the opening, "communicated": she asked them to say it again. The rest as it should be - the price and states answers word for word, stopped each time she was talked over, the why asked once, other products offered once; `hung_up`, 75 seconds. Softer: "I can't give exact prices" after the price answer, and again the states answer said twice over |

## Done when

- [ ] Every line heard and noted with its date in `docs/AI-AGENT.md`, like T26; then A22.

## Docs to update in the same commit

- `docs/AI-AGENT.md`, A21's ticket, this tracker.
