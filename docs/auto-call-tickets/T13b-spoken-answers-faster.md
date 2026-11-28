# T13b · Spoken answers understood faster

**Goal:** after a lead speaks, the call goes on about as fast as after a key.

**Depends on:** T13 · **Size:** - · **Status:** Done 2026-10-19 - Deepgram: 4 s of
silence down to 2.4-3.3 s, measured · **Deploy note:** none.

## Build

- Found on T13's real calls (2026-10-19): about 4-5 seconds between a spoken
  answer and the call going on; a key press is near-instant. Our server
  answers Twilio in about 0.2 seconds (Twilio's own request log), so the time
  is Twilio deciding the lead has stopped and working out the words - not
  making the voice, since after a key the reply starts at once.
- Measure first: record one test call, both sides, and find in the audio when
  the lead stopped speaking and when the reply started - the gap, in tenths
  of a second.
- Then try, one at a time and measured the same way: `speechTimeout` in
  whole seconds with Twilio's own model; a provider's own model - Google's
  `googlev2_telephony_short`, Deepgram's `deepgram_nova-3` - which Twilio does
  not fail over in an outage. Already tried: `experimental_utterances` - no
  faster, and a clear "yes" at 0.24 and 0.00.
- Keep the fastest that hears "yes", "no" and "stop calling me" as surely as
  now (0.5 to 0.95).
- Jeel's call, not a must: the questions could invite keys ("…Say yes, or
  press 1."), which are instant and never misheard.

**Files:** `backend/src/integrations/twilio.ts` (+ test).

## Done when

- [x] The gap measured on a recorded call, before and after - 4.0-4.3 s of
      silence before, 2.4-3.3 s after; Twilio's part 3.3 s before, 1.6-1.7 s
      after.
- [x] The chosen setting no less sure of yes, no and stop on real calls -
      "no" 0.97, "no thank you" 0.999, "stop calling me" 0.998, "yes" 0.53
      (0.61 before).
- [x] Jeel hears the difference on his phone - six recorded calls,
      2026-10-19.

## Docs to update in the same commit

`AUTO-CALLS.md`, "Understanding an answer".

## As built

`AUTO-CALL-SCRIPT.md`, "Understanding an answer", "How fast". Three settings were measured
on recorded calls and Deepgram's `nova-3` with a one-second end was kept. A
fixed one-second end on Twilio's own model was faster on a quiet line but
slower than before when a noise restarted its wait. Not done: the reply's
voice still takes 0.8-1.5 s to start, and a question's lead-in and the
question itself have about 0.9 s between them - audio made once would shrink
both, a separate change if wanted. Inviting keys in the questions was not
needed.

**How it was measured** (moved here from `AUTO-CALLS.md` on 2026-11-27, "How fast") - repeatable: the test
call recorded on both sides through Twilio's recordings API (two channels,
deleted after); in each channel, speech found by loudness every 20 ms; the
lead's last word, the moment the answer reached our server
(`webhook_events.received_at`) and the reply's first sound lined up on the
recording's clock.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
