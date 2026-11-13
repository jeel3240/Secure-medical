# A21 · Every path on a real phone

**Goal:** Jeel hears every path on the dev number before anything reaches production.

**Why:** Decided by Jeel: test as much as possible before launch, then switch everything on.

**Depends on:** A20  ·  **Size:** Medium (about a day)

## Before the calls (optional checklist)

- The local `.env` holds the dev number (480) 530-8582, its TwiML App and
  `TWILIO_IDENTITY_PREFIX=dev-` - never (480) 470-8259 (`CLAUDE.md` §7).
- A tunnel, set as `PUBLIC_URL`; `AUTO_CALLS=on`; our own phones in
  `AUTO_CALL_TEST_NUMBERS`; `OPENAI_API_KEY` set. Recreate the api, then
  `dev:twilio:configure -- --dry-run`, then for real.
- `npm run ai-agent -- on`.
- Two browsers signed in, a headset on each, reloaded, **Taking calls** on.
- Calls placed with `npm run dev:auto-call` (`--again` for a fresh test lead).
  It places the call without asking whether OpenAI is up - only the worker's
  dialler asks - so the "OpenAI down" cases below go through one look of the
  dialler, as T26 did, not the whole worker: its poll would text the test
  contacts.

## Build

- Checklist, each on the dev number to our own phones:
  - **The greeting:** "Hi, is this Dana?" said the moment the phone is picked
    up; a test lead with no first name hears "Hi there!". How long from the
    lead's first words to hers.
  - **Yes, now:** put through - the lead's own agent rung alone first, then
    everyone free; someone on a call - the hold line, then rung from hold;
    nobody coming - the busy line. The ring's card reads "Transfer · said yes
    to the offer".
  - **Yes, with nobody there** (Taking calls off everywhere): she does not
    transfer - she says everyone is busy and offers a call back instead.
  - **Yes, later:** a call back at a time the lead picks - in the lead's own
    zone from the area code, inside the agents' hours; refused outside them
    (8 PM, Sunday) with another time offered. Then: the badge on the lead's
    page, "Callback booked" on Admin > Leads, nothing in the queue until due,
    then first in the queue in bold; the first agent to pick the lead up takes
    it - on their My Callbacks, her line in Last note.
  - **No, then the link;** two no's - a goodbye, not interested.
  - Every playbook objection; a question she cannot answer - the specialist
    line, never "I don't know".
  - Price and medical questions: no price, no advice - the specialist line.
  - Talking over her; "hmm" while she talks (she goes on).
  - Silence: "are you still there?" at 6 seconds, a goodbye 6 more; a call
    past three minutes wraps up.
  - **Stop:** "stop calling me", "remove me", key 9 - blocked at once,
    whatever she was saying. "Do I need to stop my other medicine?" is a
    question for her, not a stop.
  - **Voicemail while she talks:** the beep decides; her goodbye, the link or a
    call back waits for Twilio's verdict, so a greeting she took for a "no"
    still gets the voicemail message.
  - Hang-ups: mid-call; straight after she says she will text the link - the
    link still goes.
  - **OpenAI failing mid-call:** a key made for the test, revoked in OpenAI's
    dashboard while she talks - never production's key - "Sorry about that."
    and the script's first question.
  - **OpenAI down before calling:** the dialler places nothing, and says so
    once (`ai_agent.openai_down`); three calls in a row falling back pause it
    for 15 minutes (`ai_agent.fallbacks_paused`).
  - **Switched off mid-day** (`-- off`): a call with her finishes; the next
    gets the script.
  - **What the agent sees:** the lead's timeline - the call's line, **Answers**,
    and **Seri** with her conversation and how it ended.
- Wording to watch: numbers and times as Rachel says them ("Monday at 3 PM
  your time"), the call-back number read digit by digit, anything she says
  that sounds like a promise we do not make.

## Done when

- [ ] Every line passed and noted with the date in `docs/AI-AGENT.md`, like T26.

## Tests

- This ticket is the test.

## Docs to update in the same commit

- `docs/AI-AGENT.md`.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
