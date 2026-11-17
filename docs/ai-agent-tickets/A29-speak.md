# A29 · Speak: her words for each move

**Goal:** Seri words each move herself - from its facts, in her voice and tones - and the client's approved answers are said exactly as written.

**Why:** today's one prompt holds every rule, objection and example, and she copies examples word for word (the opening repeated on call 112) and repeats herself. With the decision already made, she gets only what this reply needs.

**Depends on:** A27  ·  **Size:** M  ·  **Status:** Done 2026-11-17

## Build

- `backend/src/ai/speak.ts`: a cached persona (who she is, how she speaks, her tones, the call's details), then the move brief with its facts, the recent turns, and only what matters now from what she already said ("you gave the specialist answer once", "your open question was …", "don't start with 'Totally fair' again").
- An approved answer is sent by code, word for word, the moment the policy decides, in the tone the policy picks; Speak writes what follows it while it is said.
- In a reply that ends the call, a sentence with a question is not said; with nothing left, the relay's own last line (`lastLine`).

## Done when

- [x] Each move passes at least 95% over 10 runs: 97.6% overall (205 of 210); two cases at 8 of 10 (below).
- [x] Approved answers word for word every time - said by code; "I don't know" and "can't provide" replaced by the safety check on a call; "connect you" with nobody free not seen after the brief said so.
- [x] Her words vary between runs - read in the ten runs of each case: no two replies the same.

## As built

`docs/AI-AGENT.md` section 12, "As built: speak (A29)". 21 cases, ten runs each: 97.6%. Below 95%: the first specialist answer with nobody free (8 of 10) and the other products (8 of 10, "STD" for "STI" - accepted since). Every specialist miss began "I don't have that info…", so that phrase became a safety-check replacement (`cant_answer`) - on a call the lead hears the specialist line instead; the instructions alone had made it "less often, not never" on calls 111 and 112.

Not as planned: speak's model stays `gpt-4.1-mini` - 0.53 s to the first word, A24's fastest, and A21's calls shaped her voice on it.

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 1, 5 and 12, this tracker.
