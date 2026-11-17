# A26 · Knowledge: ids and offer tags

**Goal:** the knowledge files say plainly what the new brain needs to decide with: every objection has an id, and every approved answer is the client's facts alone, with the offers it leads to as tags.

**Why:** the policy (A27) offers a person, a call back or the link by who is there and by what was already offered. Today four answers carry their own offer at the end - `price`, `which_medication`, `medical_question` ("I can connect you with a representative now, or have someone call you"), `personal_info` ("I can text you the link") - which says "now" with nobody free and offers again what was turned down. The understand step (A28) names an objection by id; today they have none.

**Depends on:** A24  ·  **Size:** S  ·  **Status:** To do

## Build

- `sales-playbook.json`: an `id` on each objection; `answers.json`: each answer's offer moved out of its words into `offers` - `connect`, `callback`, `link` - its facts kept word for word.
- `knowledge.ts`: checks the ids are unique and the tags known; the version bumped in all three files.

## Done when

- [ ] The loader's tests: a missing or repeated id, an unknown tag, refused.
- [ ] Jeel approves each answer as split - its words, and the offers taken out.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 5, this tracker.
