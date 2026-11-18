# A33 · Listening

**Goal:** the way Twilio decides the lead has finished speaking is chosen from calls measured on the dev number.

**Why:** Twilio's Smart Turn Detection is new (generally available 2026-11-13) but does not apply with Deepgram Flux, which uses its own end of turn; Flux has its own settings (`eotThreshold`, 0.5-0.9, default 0.8; `partialPrompts`, an early end-of-turn 150-250 ms before the final). Nova-3 without either cut sentences in half on A02's calls.

**Depends on:** A30  ·  **Size:** S  ·  **Status:** Done 2026-11-18 - `partialPrompts="true"` and `eotThreshold="0.6"`, chosen on calls 118 and 119

## Build

- Dev calls with each: Flux as today; Flux with a lower `eotThreshold`; Flux with `partialPrompts` and understand started early; Nova-3 with `turnDetection="true"`.
- The gap from the lead's last word to Seri's first sound, and how often she cut in on a pause.

## Where it stands (2026-11-17)

Nothing to build before it is measured: the settings are Twilio's, and only real calls show the gap from the lead's last word to Seri's first sound. So it is done during A34, on the same dev calls:

- **Read on every call already:** `ai_brain.turn` (`understood` - fast or OpenAI - and `understandMs`) and `ai_relay.reply` (`latencyMs`, from the lead's words reaching us to her first sentence going out).
- **Tried, one setting per few calls:** Flux as today (`eotThreshold` 0.8, the default); `eotThreshold` 0.6 - she answers sooner, may cut in on a pause; and, only if the wait is still long, `partialPrompts` with understand started early (a code change, then) or Nova-3 with `turnDetection="true"`.

## Progress

- **2026-11-17, understanding started early** (Jeel: faster, with no change to the model or the instructions) - `partialPrompts="true"` and the brain's head start on words still being said; `docs/AI-AGENT.md` section 12, "As built: understanding started early (A33)". To be measured on the next calls; then `eotThreshold` 0.8 against 0.6 if it helps.
- **2026-11-18, call 118, measured:** the head start works but gains little - four of the six replies that needed the understand step used it, two came before the 150 ms settle; the wait on understanding was still 0.7-2.3 s (one 3.7 s), the request itself 0.7-1.8 s from inside the api that minute. Twilio's partial words arrive only 150-250 ms before its end of turn, so that gap is all a head start can save. `ai_brain.turn` now logs `partials`, `lastPartialMs` and `headStartMs` (`feat/a33-head-start-measured`), so the next call measures the gap itself. Next: `eotThreshold` 0.6, which shortens Twilio's own wait before the final words.
- **2026-11-18, `eotThreshold="0.6"`** (`feat/a33-eot-threshold`): Flux sends the lead's words sooner than at its default 0.8. To be heard on call 119 with a pause mid-sentence said on purpose - sooner, and no cutting in, or back to 0.8.
- **2026-11-18, call 119, heard - kept:** a pause of about a second said on purpose mid-question ("How long does... shipping take?") reached us as one turn - she did not cut in; and Jeel heard her answer a little sooner than on call 118. Our own part of the wait was unchanged, as expected - 1.0-1.9 s, one 3.9 s - since the threshold acts before the words reach us. On every reply the last partial words came 0.1-0.45 s before the final ones, and the head start, when used, had run 0.01-0.26 s. Not known: whether one word heard alone after the opening ("communicated", asked to repeat) was a turn ended early at 0.6 or noise on the line. **Chosen:** both settings stay. What is left of the wait is OpenAI's own time - the understand step, then the speak step when a reply needs her words.

## Done when

- [x] Measured on calls 118 and 119 - section 12, "As built: understanding started early (A33)" - and the chosen settings in `RELAY_SETTINGS`.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 1, this tracker.
