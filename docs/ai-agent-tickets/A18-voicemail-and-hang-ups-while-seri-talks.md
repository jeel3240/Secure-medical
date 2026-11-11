# A18 · Voicemail and hang-ups while Seri talks

**Goal:** The T18 voicemail rules and hang-ups hold while Seri is on the call.

**Why:** A machine must get the voicemail message, not a conversation.

**Depends on:** A14  ·  **Size:** Small (a few hours)

## Build

- `/auto/amd` during a Seri session: a beep replaces the call with the voicemail message (`onVerdict`), as today; any lead turn in `call_ai_turns` counts as "answered".
- **No ending action before the verdict.** Seri hears a voicemail greeting as the lead talking - "John isn't available" can sound like a no, or a wrong person. Until Twilio's verdict on who answered has come (`calls.answered_by`), an action that would end the call (`end_call`, `send_link`, `book_callback`) waits, for a few seconds at most; a beep in that time replaces the call with the voicemail message, as today. A transfer and a stop do not wait.
- Lead hangs up mid-conversation: `/auto/ai-after` gets `completed`, result `hung_up`, and the relay closes cleanly.
- A transfer Seri started is not cut by a late "machine" verdict (same as T18).
- After the voicemail message has taken the call over, Twilio may still post the session's end to `/auto/ai-after`: ignored and logged as `after_takeover`, as `/auto/gather` and `/auto/after` already do.

## Done when

- [ ] Route tests for each case.
- [ ] A greeting followed by a beep leaves the voicemail message, even when Seri chose `end_call` on the greeting.

## Tests

- Route tests; relay tests with the verdict late, early, and never.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 2.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
