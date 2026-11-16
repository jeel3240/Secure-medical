# A23 · A voicemail menu is never put through

**Goal:** a voicemail's own menu - "To review your message, press 1" - is never taken for a lead's "yes", on the script or with Seri: the voicemail gets our message, and nobody is rung for a machine.

**Why:** seen on production twice, on the script (2026-11-13 and 2026-11-16). The call reached voicemail. The script asked its question into the recording and went quiet to listen; the voicemail took the silence as the end of the message and played its menu; the script heard "One" on one call and "1." on the other - a number said alone counts as that key (T7, `AUTO-CALLS.md`, "Understanding an answer") - took it as a yes, and put the call through. The agent who took it heard the menu for about 50 seconds and hung up; one wrote "voicemail answered" as the note. No voicemail message was left: the voicemail holds the script's question instead. On the second call the script had first heard "After you" - most likely the greeting's "after the tone" - and asked again, with "Press 1 for yes".

Twilio's verdict did not stop it: once an answer is kept, only a beep is trusted (`onVerdict`, T18) - written down as not covered in `AUTO-CALLS.md`, "Voicemail". With Seri the rule is the same (A18: anything said to her counts as an answer), and she has never been told what a voicemail sounds like - so it is not fixed by her on its own. The script also stays her backup when OpenAI fails.

**Depends on:** A22 - decided by Jeel, 2026-11-16: after the main AI agent work  ·  **Size:** Medium (about a day)  ·  **Status:** Later

## First, find out

1. **What Twilio said on those two calls**, read on production, nothing changed (below). Its verdict decides the fix: `human` or `unknown` - nothing from Twilio will help, it must come from what was heard; a machine with no beep (`machine_end_silence`, `machine_end_other`) - the rule above ignored it; a beep after the agent took the transfer - too late.
2. **What Seri does today**, in the answer test set (A09), with a voicemail's words as the lead's: a greeting ("You've reached ..., please leave a message after the tone"); the greeting and then nothing; the menu ("To review, rerecord, or add to your message, press 1. To mark your message urgent, press 2."). Then a real call to a phone whose voicemail plays such a menu, if one of ours does.

```sql
-- Read-only. :ids - the two calls' ids (calls.id, direction 'automated').
SELECT id, started_at, answered_by, script_result, outcome, duration_sec, agent_id
FROM calls WHERE id IN (:ids);

-- What was heard each time it listened, and how sure Twilio was.
SELECT call_id, step_key, attempt, heard, confidence, digits, result, created_at
FROM call_answers WHERE call_id IN (:ids) ORDER BY id;

-- Every webhook of the calls, in order: Twilio's verdict (/auto/amd) and when, the transfer's ring.
SELECT received_at, path, payload->>'AnsweredBy' AS answered_by,
       payload->>'MachineDetectionDuration' AS detect_ms, payload->>'CallStatus' AS status,
       payload->>'DialCallStatus' AS dial_status, payload->>'SpeechResult' AS speech
FROM webhook_events
WHERE path LIKE '/api/webhooks/twilio/auto/%'
  AND substring(path FROM 'call=(\d+)')::int IN (:ids)
ORDER BY id;
```

## Build - chosen from what the above finds

Options, not all of them:

- **The script - a number said alone** counts as its key only once the repeat line has asked for keys ("Press 1 for yes..."). The first call's "One" was on the first asking, which never mentions keys; the second call's "1." was after the repeat line, so this alone stops one of the two.
- **The script - words only a voicemail system says** - "press", "your message", "record", "after the tone" - heard as a machine, not as unclear: the voicemail message, then the end.
- **Twilio's verdict** - a machine with no beep trusted when the only answer kept is a number said alone: not a "yes", not a key.
- **Seri** - the fact of what a voicemail greeting and its menu sound like, and what to do: say nothing more, and hand the call to the voicemail message - which needs a way to do it, for example an end reason that does what a beep does. A fact and a principle, not a line for her to say.

## Done when

- [ ] The two production calls, played back as cases - the script through `matchSpokenChoice` and `handleAnswer`, Seri through the answer test set - are not put through.
- [ ] A person still goes through: a "yes" said over a greeting's end (call 24, T18), and "one" said after the repeat line.
- [ ] A real call to a voicemail with a menu: the voicemail message left, nobody rung.

## Not in this ticket

- A "yes" that nobody took, and the lead then not called back - a person's work, not the call's (`QUEUE.md`, "Wants a call").

## Docs to update in the same commit

- `docs/AUTO-CALLS.md`, "Voicemail" and its "Not covered"; `docs/AI-AGENT.md`, the voicemail row in section 2 and A18's "As built"; this tracker.
