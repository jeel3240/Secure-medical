# A33 · Listening

**Goal:** the way Twilio decides the lead has finished speaking is chosen from calls measured on the dev number.

**Why:** Twilio's Smart Turn Detection is new (generally available 2026-11-13) but does not apply with Deepgram Flux, which uses its own end of turn; Flux has its own settings (`eotThreshold`, 0.5-0.9, default 0.8; `partialPrompts`, an early end-of-turn 150-250 ms before the final). Nova-3 without either cut sentences in half on A02's calls.

**Depends on:** A30  ·  **Size:** S  ·  **Status:** To do

## Build

- Dev calls with each: Flux as today; Flux with a lower `eotThreshold`; Flux with `partialPrompts` and understand started early; Nova-3 with `turnDetection="true"`.
- The gap from the lead's last word to Seri's first sound, and how often she cut in on a pause.

## Done when

- [ ] A measured table in section 1, and the chosen settings in `RELAY_SETTINGS`.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 1, this tracker.
