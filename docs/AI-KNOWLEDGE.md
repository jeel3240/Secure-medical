# What Seri knows

Everything Seri may say about eDrugstore is in three JSON files in `backend/src/ai/knowledge/`, written from the client's emails and a crawl of edrugstore.com and approved by Jeel. `backend/src/ai/knowledge.ts` imports them - so the build carries them into `dist/` - checks them once when the api starts, and hands them out typed. Listed here: what each file holds, which parts a call reads, the rules the files keep, each version, and where the words came from. How a call uses them - the approved answers said by code, the facts each reply's brief carries - is [AI-BRAIN.md](AI-BRAIN.md).

## The files

| File | Holds |
|---|---|
| `answers.json` | 10 rules, and 37 spoken answers - 36 approved, 1 open (`medical_web`) - each with the questions it answers, its words, who approved it and when (`source`), and the offers it leads to |
| `products.json` | The 30 products she may name - 7 antibiotics, 4 STI antivirals, the Emergency Medical Kit and 18 test kits - each with a line to say about it; `site_price_usd` for reference only |
| `sales-playbook.json` | How she talks (`style`), the 9 objections, the closing questions, what she never does (`never`), and how a change is tested (`learning`) |
| `data/edrugstore-site/` | The crawl the files were written from - reference only, **never read by the app** (below) |

The three files share one version, saved on every call she takes (`calls.ai_knowledge_version`), so what she knew on any call can be traced.

## What a call reads

Not all of a file reaches a call. The rest is kept for people - the record of what the client approved. The loader checks it too - all but each answer's `note` and each product's `site_price_usd`, which it never reads - so a broken file stops the api either way.

| File | Read by a call | Kept for people |
|---|---|---|
| `answers.json` | `rules` (speak's persona); each answer's `id` and first three `questions` (the understand step), its words - `answer`, or `fallback_answer` while its `status` is `needs_confirmation` (said by code) - and its `offers` (the policy) | each answer's `topic`, `source` and `note` |
| `products.json` | each product's `name` and `spoken_line` (speak's persona) | `slug`, `type`, `rx_required`, `url`, `site_price_usd` |
| `sales-playbook.json` | `style` and `never` (speak's persona); each objection's `id` and `lead_says` (the understand step); the `approach` of `have_doctor`, the one objection she words herself (the policy carries it on its move) | the other objections' `approach`, every objection's `example`, `closing`, `learning` |

The other objections never reach her as an approach: three are an approved answer, said word for word (`scam` as `scam`, `too_expensive` as `cheaper_pharmacy`, `never_signed_up` as `how_got_number` - `OBJECTION_ANSWERS`, `policy.ts`), and the rest are a route in code - a no, busy, the link, the other products, the wrong person. Their `approach` says so, for a person reading the file.

## The rules the files keep

| Rule | How it is kept |
|---|---|
| **No prices, ever** | `site_price_usd` is stored for reference; the typed product (`KnowledgeProduct`) has no field for it, so it never reaches a call. Every sentence is checked for a price before it is said as well (`AI-AGENT.md`, section 6) |
| **An answer not yet confirmed is said only as its fallback** | `status` is `approved` (by the client or Jeel) or `needs_confirmation`; one that needs confirmation carries a `fallback_answer`, and that is all a call gets of it (`spoken`). Only `medical_web` is open: she says "We're calling on behalf of eDrugstore." |
| **An answer's words are facts, its offers beside them** | What an answer leads to - `connect` (a person), `callback`, `link` - is its `offers` list, never in its words: said word for word, an answer's own "I can connect you now" was said with nobody free, and offered again what the lead had turned down. Which offer is made, and in what words, is the policy's, by who can take the call and what was already offered ([AI-BRAIN.md](AI-BRAIN.md), "Rules"). Five answers carry offers - `price` (connect, link); `which_medication`, `medical_question` and `upset` (connect, callback); `personal_info` (link) - and the ending each once had is kept in its `note`. `products_overview`, `talk_to_doctor` and `customer_service` only mention a representative, and have none |
| **Objections are named by id** | `not_interested`, `too_expensive`, `scam`, `busy`, `think_about_it`, `have_doctor`, `dont_need_antibiotics`, `never_signed_up`, `wrong_person` - how the understand step labels them (`objection:<id>`). `not_interested` and `wrong_person` are written as the plain acts instead, so each has one label |
| **One placeholder** | `{callback_number}` in an answer is the number the call came from (`TWILIO_PHONE_NUMBER`), read out digit by digit as the voicemail message reads it (`spokenNumber`): (480) 470-8259 on production, the dev number (480) 530-8582 on a laptop |
| **Two lines are not from the files** | That she is eDrugstore's virtual assistant when asked if she is a person (approved by Jeel), and her saved introduction (`OPENING_LINE`, `speak.ts`) |

**The loader's checks** (`loadKnowledge`, `knowledge.ts`), every problem in every file listed by file and field - `answers.json: answers[id=price].answer is missing`:

- every field it reads present and not empty; one version shared by the three files;
- answer ids, objection ids and product slugs each used once; an objection id in small letters, digits and underscores, as the understand step writes it;
- `status`, a product's `type` and `rx_required` from their lists; an offer known, and not listed twice;
- product URLs `https://`;
- an open answer has its `fallback_answer`;
- no placeholder but `{callback_number}` in anything she says.

Any problem and the api does not start: `api.refused_start` with `reason: ai_knowledge_invalid`, one line per problem, then it exits - whether or not Seri is switched on, since a broken file is a bug in the repo. `api.started` names the version. The tests load the real files (`knowledge.test.ts`), so a broken one fails before a deploy.

## The versions

| Version | What changed | Why |
|---|---|---|
| `approved-2026-11-23` | The `have_doctor` objection's wording moved from code into its `approach`, word for word, and `learning` brought up to date. Nothing she is given changed | Editing the file had changed nothing (review Q1) |
| `approved-2026-11-17` | Five answers' offers moved out of their words into `offers`; an `id` on each objection | The policy and the understand step (A26) |
| `approved-2026-11-16b` | The `wrong_person` objection: "Only when they say it plainly: apologize and end." (was "Apologize and end.") | A21's call 109 |
| `approved-2026-11-16` | After a no, the why asked alone, and another no ends the call; one question in a reply, never two | A21's call 99 |
| `approved-2026-11-13` | Businesslike words - never "no worries", "when you're ready", "take your time" or "I'm here for you", nor the lead's name in a line of sympathy; "Who is this?" (`why_calling`) without the partner sites | A21's calls 89 and 90 |
| `approved-2026-11-12` | Four lines of speaking style: contractions; varied words, never two replies starting the same way; now and then a small first word ("So", "Oh", "Actually"), never "um" or "uh"; matching the moment | The first test calls (A02) |
| `approved-2026-11-11` | The first | A03 |

## Where it came from

The client's emails of 2026-11-05 (the goal, the rules, delivery, what not to do) and 2026-11-09 (the call's questions, objections, products and the offer); edrugstore.com, crawled 2026-11-09 (its FAQ, policies and product pages); Jeel's legal, safety and privacy wording, and his approvals, 2026-11-09 and 2026-11-11. Each answer names its source.

**The crawl**, `data/edrugstore-site/`, is the material the files were written from. The app never reads it.

| File | What |
|---|---|
| `site-products.json`, `site-products.csv` | All 186 products on the site: name, category, price, an Rx flag (a first guess), description, URL |
| `pages-index.json` | All 576 crawled pages, tagged product, category, info, doctor profile or home |
| `raw/edrugstore-site-crawl.json` | The full crawl, 13 MB. Git-ignored: regenerate it rather than commit it |

Crawled through a browser from the site's sitemap, blog posts left out. Two pages failed: `/bundles/` and one doctor profile.

## How to add an entry

1. Edit the file - an answer, a product, an objection, a line of style - with its `source` for an answer. Never edit it on the server.
2. Bump `version` in all three files to `approved-YYYY-MM-DD`.
3. Run the loader's tests (`npm test`), the understand and speak test sets (`npm run ai:eval:understand`, `npm run ai:eval:speak`) and the real calls replayed (`npm run ai:replay`) - [AI-BRAIN.md](AI-BRAIN.md), "Tests". A new answer id or objection id is a new label the understand step can write.
4. A row in "The versions" above, and a PR into `dev`.

## History

- 2026-11-27 · Written from `AI-AGENT.md` section 5; the counts checked against the files (10 rules, 37 answers, 30 products, 9 objections); "all of it goes into her instructions, about 3,500 words" dropped as the removed brain's · D41
- 2026-11-23 · `approved-2026-11-23`; what a call reads, and what is kept only for people, written down - since the new brain not all of the files reached OpenAI, as the doc had said · review Q1
- 2026-11-19 · The whole files stopped going to OpenAI on every call: her instructions built from them (`buildInstructions`, about 3,500 words, 3,300 when first built, sent with a cache key and read from OpenAI's cache 87-95% of the time) went with the one-request brain, and the answer test set and the instructions' snapshot test with them · the new brain reads only what each step needs · `AI-BRAIN.md`, History
- 2026-11-17 · Offers out of the answers' words, ids on the objections; the cases those answers touch, three runs each, 44 of 45 · A26
- 2026-11-16 · `approved-2026-11-16` and `-16b` · A21's calls 99 and 109
- 2026-11-13 · `approved-2026-11-13` · A21's calls 89 and 90
- 2026-11-12 · `approved-2026-11-12`, four style lines; the answer test set, old and new side by side, 198 and 199 of 201 · A02's calls
- 2026-11-11 · The three files, and the loader that stops the api on a broken one · files, not database tables: nobody edits answers from a screen, and every change goes through a PR either way · A03
