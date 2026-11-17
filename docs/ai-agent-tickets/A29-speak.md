# A29 · Speak: her words for each move

**Goal:** Seri words each move herself - from its facts, in her voice and tones - and the client's approved answers are said exactly as written.

**Why:** today's one prompt holds every rule, objection and example, and she copies examples word for word (the opening repeated on call 112) and repeats herself. With the decision already made, she gets only what this reply needs.

**Depends on:** A27  ·  **Size:** M  ·  **Status:** To do

## Build

- `backend/src/ai/speak.ts`: a cached persona (who she is, how she speaks, her tones, the call's details), then the move brief with its facts, the recent turns, and only what matters now from what she already said ("you gave the specialist answer once", "your open question was …", "don't start with 'Totally fair' again").
- An approved answer is sent by code, word for word, the moment the policy decides, in the tone the policy picks; Speak writes what follows it while it is said.
- In a reply that ends the call, a sentence with a question is not said; with nothing left, the relay's own last line (`lastLine`).

## Done when

- [ ] Each move passes at least 95% over 10 runs (`evals/grade.ts`'s `says` and the safety check reused).
- [ ] Approved answers word for word every time; never "I don't know", "can't provide" or "connect you" with nobody free.
- [ ] Her words vary between runs - measured, not copied.

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 1, 5 and 12, this tracker.
