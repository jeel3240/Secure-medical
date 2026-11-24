# A26 · Knowledge: ids and offer tags

**Goal:** the knowledge files say plainly what the new brain needs to decide with: every objection has an id, and every approved answer is the client's facts alone, with the offers it leads to as tags.

**Why:** the policy (A27) offers a person, a call back or the link by who is there and by what was already offered. Today four answers carry their own offer at the end - `price`, `which_medication`, `medical_question` ("I can connect you with a representative now, or have someone call you"), `personal_info` ("I can text you the link") - which says "now" with nobody free and offers again what was turned down. The understand step (A28) names an objection by id; today they have none.

**Depends on:** A24  ·  **Size:** S  ·  **Status:** Done 2026-11-17

## Build

- `sales-playbook.json`: an `id` on each objection; `answers.json`: each answer's offer moved out of its words into `offers` - `connect`, `callback`, `link` - its facts kept word for word.
- `knowledge.ts`: checks the ids are unique and the tags known; the version bumped in all three files.

## Done when

- [x] The loader's tests: a missing or repeated id, an unknown tag, refused.
- [x] Each answer as split shown to Jeel, 2026-11-17 - its facts word for word, only the offer at its end taken out (below).

## As built

- **Five answers split** - `price`, `which_medication`, `medical_question`, `upset`, `personal_info`: their facts word for word as `answer`, the offer at the end as `offers` (`connect`, `callback`, `link`), the old ending kept in `note`. `products_overview`, `talk_to_doctor` and `customer_service` only mention a representative, and are unchanged. Shown to Jeel the same day; asked to approve, he said he did not follow the question, so the split was made as the smallest change - nothing of the client's facts changed, only an offer moved - and is written down here and in section 5.
- **Objection ids:** `not_interested`, `too_expensive`, `scam`, `busy`, `think_about_it`, `have_doctor`, `dont_need_antibiotics`, `never_signed_up`, `wrong_person`.
- **Today's brain keeps working** until A30: her instructions name an answer's offers after it, by who is there (`offersLine`, `instructions.ts`). The cases these answers touch, three runs each: 44 of 45 - "Prices depend on the medication and quantity." and then her own offer; the miss a sentence the safety check replaced.
- Version `approved-2026-11-17` in all three files. 608 AI tests.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 5, this tracker.
