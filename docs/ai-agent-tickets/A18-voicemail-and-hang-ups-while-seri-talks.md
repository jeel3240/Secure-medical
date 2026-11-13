# A18 · Voicemail and hang-ups while Seri talks

**Goal:** The T18 voicemail rules and hang-ups hold while Seri is on the call.

**Why:** A machine must get the voicemail message, not a conversation.

**Depends on:** A14  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-12

## Build

- `/auto/amd` during a Seri session: a beep replaces the call with the voicemail message (`onVerdict`), as today; any lead turn in `call_ai_turns` counts as "answered".
- **No ending action before the verdict.** Seri hears a voicemail greeting as the lead talking - "John isn't available" can sound like a no, or a wrong person. Until Twilio's verdict on who answered has come (`calls.answered_by`), an action that would end the call (`end_call`, `send_link`, `book_callback`) waits, for a few seconds at most; a beep in that time replaces the call with the voicemail message, as today. A transfer and a stop do not wait.
- Lead hangs up mid-conversation: `/auto/ai-after` gets `completed`, result `hung_up`, and the relay closes cleanly.
- A transfer Seri started is not cut by a late "machine" verdict (same as T18).
- After the voicemail message has taken the call over, Twilio may still post the session's end to `/auto/ai-after`: ignored and logged as `after_takeover`, as `/auto/gather` and `/auto/after` already do.

## From A14

- Built in A14: `/auto/ai-after` after the voicemail's takeover does nothing and logs `after_takeover`; a hang-up (`completed`) carries out what the relay had recorded she ended with, or nothing - the call's end then saves `hung_up`. Left here: the verdict while she talks, actions waiting for it, and the relay closing cleanly.

## Done when

- [x] Route tests for each case - the routes are unchanged: `/auto/amd` acts as T18's tests prove, and `/auto/ai-after` after a takeover and after a hang-up as A14's do. What changed is under them - the rule's SQL (live check) and the relay's wait (conversation and relay tests).
- [x] A greeting followed by a beep leaves the voicemail message, even when Seri chose `end_call` on the greeting - the rule with the greeting as her lead turn gives `voicemail` on the beep (`ai-agent-live-check`), and her `end_call` held in the wait ends nothing once the message has the call (conversation and relay tests).

## Tests

- Route tests; relay tests with the verdict late, early, and never.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 2.

## As built

- **The rule** (`actOnVerdict`): `answered` also reads `call_ai_turns` - any lead turn; `key_pressed` a lead turn starting `(pressed ` (`KEY_TURN_PREFIX`, `ai/relay-messages.ts`, which `keyTurn` writes too). `onVerdict` itself is unchanged.
- **The wait** (`ai/conversation.ts`): `end_call` - hers and the relay's own - `send_link` and `book_callback` keep her choice at once, then ask `verdict()` every half second (`VERDICT_POLL_MS`) for up to 15 seconds (`VERDICT_WAIT_MS`) before recording her part and sending `end`. `in` or none in time: ended as chosen. `taken`: nothing ended or recorded, a `system` note (`VOICEMAIL_TOOK_NOTE`). The socket closing: nothing more. Unreadable: not held. Kept at once, not after the wait, so a lead who hangs up in the wait still gets the link (A14 reads the kept action).
- **"A few seconds at most" became 15:** the real calls had Twilio deciding a person 3.4 to 6.6 seconds in, and a machine only when its greeting ends - 9 seconds on T18's real voicemail - so a short wait would have ended on most greetings before their beep. A person, decided early, seldom waits.
- **`verdictState`** (`ai/relay-store.ts`): `pending`, `in` (`answered_by` set), `taken` (`TAKEN_BY_VERDICT_SQL`).
- **Already built in A14:** `after_takeover` on `/auto/ai-after`, and a hang-up as `completed`.
- **Logged:** `ai_relay.verdict_wait`.
- **Tests:** 8 conversation, 4 relay, 9 live checks (`ai-agent-live-check`, 116); 1,629 backend tests, all 23 live checks.
- **Seen on the real API:** her goodbye held from 12.5 to 15.6 seconds until a pretend Twilio's verdict, the end 20 ms after it.
- **Not covered:** a beep after her goodbye has been sent and the 15 seconds are over - the call has ended by then; and Twilio's verdict on a real machine while she talks - A21, on a real phone.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
