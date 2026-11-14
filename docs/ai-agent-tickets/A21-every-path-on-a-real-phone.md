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
- Wording to watch: numbers and times as Aria says them ("Monday at 3 PM
  your time"), the call-back number read digit by digit, anything she says
  that sounds like a promise we do not make.

## Progress

**2026-11-13, the setup and the first calls** - the dev number, a tunnel, `AUTO_CALLS=on`, Jeel's phone the only test number, Seri switched on, the api alone (no worker); calls placed with `dev:auto-call --again`.

| Call | What happened | Found |
|---|---|---|
| 86, 87 | Picked up, then 8-9 seconds of nothing, "are you still there?" | Jeel's earbuds were still connecting - not the app: she was connected and greeting 0.5 s after the pick-up both times |
| 88 | The greeting, "Yes", the offer, a question about what we sell, "Yes" - put through, the laptop rang | Every step right. The ring ended `busy` - declined in the browser - so `transfer_missed`. Her voice, Rachel, did not sound like a real woman |
| - | A comparison call, eight voices on a key menu (a throwaway server, never merged) | Aria picked; `v3_conversational` would not play (Twilio 64112) |
| - | Aria plain, with tones, and with tones more freely | Tones at stability 0.4 picked |
| 89 | Aria with tones: busy, "is it a scam?", "No" | Her opening said "You signed up on one of our partner sites" - not wanted. After the "No" she texted the link in the same reply as asking why - not asked for (below) |
| 90 | The new opening; "Who is this?"; "How did you get my number?" | The partner sites only when asked how we got the number - right. "No worries, Jeel" and "let me know when you're ready, Jeel" sounded personal - the soft tones; seven of nine replies offered to connect |
| 91 | "Yes" to the greeting, with Jeel's browser not open - nobody free | Her first reply skipped "is that something you'd be interested in?" and asked "talk with someone now, or a call back at a better time?" - the "Yes" taken as interest, the who-is-there note acted on at once. Hung up after it |
| 92 | The api restarted after her second reply, through a local Caddy set up as production's | Picked back up: Twilio's second try reconnected 4 seconds later, the "Yes" said meanwhile replayed and answered, no second greeting. Then, nobody free, she booked a call back for Monday at 11 AM without asking when - and had offered to connect him now with nobody free |
| 93 | Nobody free, a Friday at 4:39 PM: "Yes", then "call me tomorrow at two" | She offered to connect him now again, then "Would 2 PM tomorrow work?" - a Saturday; refused by the check, she asked again for Monday at 2 PM, booked. Repeated itself - fixed on `fix/seri-friday-callback`: `docs/AI-AGENT.md` section 4, "Changed after A21's call 93" |
| 94 | Nobody free, Friday: "call me tomorrow", then three side questions - "Do you know my time?", "Who is the person?", "What's the person's name?" | No "connect you now", Saturday explained, Monday 2 PM booked only after a yes - the fixes held. But her first answer to "tomorrow" skipped why, and she ended each answer to a side question with "Does Monday at 2 PM your time work...?" near word for word. Fixed on `fix/seri-no-repeat-question`: `docs/AI-AGENT.md` section 4, "Changed after A21's call 94". Not changed, Jeel's call: she called the agents "licensed", which her knowledge never says, and said "2 PM your time would be 2 PM Arizona time" to a lead in Arizona |

All changed on `feat/seri-voice-aria-tone` - `docs/AI-AGENT.md` section 1, "Her voice and tone": Aria; seven businesslike tones; the opening and "Who is this?" without the partner sites; no "no worries" or "when you're ready"; a note against offering to connect twice in a row; an action written in brackets taken; and a stop never held back by a question.

Call 91's opening fixed on `fix/seri-opening-line` - `docs/AI-AGENT.md` section 1, "Her first reply is always the opening".

Seen on every call so far, not changed: Twilio logs a warning (12200) that `applicationReconnect` is not allowed on `<ConversationRelay>`. The attribute is in Twilio's own ConversationRelay reference, so the warning is its XML check out of date, and the calls are unaffected. Looking into it found the relay refused Twilio's reconnect - a deploy mid-call handed the lead to the script, or to Twilio's error. Fixed on `feat/seri-reconnect` and heard on call 92 - `docs/AI-AGENT.md` section 2, "When the line drops".

Call 92's call back and offer fixed on `fix/seri-callback-asks-time` - a call back is booked only for a time she said back and the lead agreed, and with nobody free she asks when instead of offering to connect: `docs/AI-AGENT.md` section 4, "Changed after A21's call 92".

Call 89's link fixed on `fix/seri-link-needs-a-yes` - an action waits for the answer to a question anywhere in her reply, not only at its end; `docs/AI-AGENT.md` section 3, "Two rules".

Nothing found on calls 86-94 is still open but two small things on call 94, left as they are for now (above). The rest of the list above is still to walk.

## Done when

- [ ] Every line passed and noted with the date in `docs/AI-AGENT.md`, like T26.

## Tests

- This ticket is the test.

## Docs to update in the same commit

- `docs/AI-AGENT.md`.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
