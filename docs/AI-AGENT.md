# AI agent on the automated call (Phase 7)

Design agreed with Jeel, 2026-11-11. The tickets are in `docs/ai-agent-tickets/` (A01-A22). Built so far: A01, the key and the switch; A03, the knowledge loader; A04, her instructions; A05, the sentence check; A06, her five actions; A07, the call-back time rules; A08, migration 022; A09, the answer test set, which chose the model (all 2026-11-11).

Today the automated call (`docs/AUTO-CALLS.md`) is a fixed script: it understands "yes", "no", "stop" and the keys 1, 2 and 9, and anything else is asked once more before the call ends. On day one (250 calls), 82 leads hung up and 65 ended as `no_response`.

Phase 7 puts an AI agent, **Seri from eDrugstore**, on the call **from the start**. She talks like a salesperson: opens the call, gives the offer, answers questions, handles objections, and steers every call to one outcome - a person now, a call back at a time the lead picks, the link, or a polite goodbye. Everything after that outcome (transfer, hold line, link text, opt-out, voicemail) is the code that runs today.

---

## The seven decisions

| # | Decision | Section |
|---|---|---|
| 1 | Twilio ConversationRelay with an OpenAI text model and an ElevenLabs voice, not OpenAI's voice-to-voice | 1 |
| 2 | The AI runs the whole call from the start. Today's script stays only as the backup | 2 |
| 3 | Seri follows a sales playbook, knows on every turn whether anyone can take the call, and ends every call with one of five actions | 3 |
| 4 | Seri can book a call back at a time the lead picks; it reaches agents when due | 4 |
| 5 | What Seri knows is three JSON files in `backend/src/ai/knowledge/`, not database tables | 5 |
| 6 | 3-minute limit; OpenAI checked before calling; any failure falls back to the script | 6 |
| 7 | Tested on the dev number, deployed off, then switched on for every call with a server command | 7 |

---

## 1. How Seri talks on the call

```
Lead speaks
   → Twilio turns speech into text (Deepgram)
   → our server (WebSocket) → OpenAI writes the reply as text, streamed
   → our server checks each sentence
   → Twilio speaks it (ElevenLabs voice)
   → the lead hears Seri
```

Twilio `<Connect><ConversationRelay>` does the listening and speaking. OpenAI only does the thinking, in text. Our server sits in the middle and sees every word both ways.

### Why this and not OpenAI Realtime (voice to voice)

Decided by Jeel, 2026-11-11, after comparing published tests:

| | ConversationRelay + OpenAI text | OpenAI Realtime |
|---|---|---|
| Speed on real phone calls | About 1 second. Twilio's own test: 0.5 s typical | About 1 second. Faster in the lab, but one independent test of real agents measured 1.6 s on average |
| Lead talks over Seri | Built in. Twilio tells us exactly which words the lead heard before cutting in | Built in, but developers report it stops on "hmm" and "okay", and struggles in the first seconds of a call |
| Checking each sentence before it is said (no prices, no medical advice) | Yes | Not really: it relies on instructions |
| Fits today's code | The session ends into a normal TwiML `action` URL, so transfer, hold and link are reused as they are | Needs the call redirected out of a raw audio stream |

### What makes it sound human

| Setting | What it does |
|---|---|
| ElevenLabs voice (`ttsProvider="ElevenLabs"`) | One of the most natural voices. Provided by Twilio: no ElevenLabs account. Jeel picks one of two or three on the dev number (A02). It exists only inside the ConversationRelay session - a TwiML `<Say>` cannot use it - so Seri says her own last line before the session ends (section 3) |
| `welcomeGreeting` | The opening ("Hi, is this John?") is said by Twilio the moment the lead picks up, with no wait on OpenAI - the second in which most of the 82 hung up |
| `interruptible="speech"` | Seri keeps listening while she talks, and stops the moment the lead speaks. The part she never said is cut from the AI's history |
| Deepgram end-of-turn detection | Seri replies when the lead has finished a thought, not at the first pause |
| Streaming, short replies | Seri starts speaking on the first words OpenAI writes; replies are 1 to 2 sentences |

Twilio provides Deepgram too, so the only accounts needed are Twilio (have it) and OpenAI (key from the client, 2026-11-09).

**The model: `gpt-4.1-mini`** (`backend/src/ai/model.ts`), chosen by the answer test set (A09, 2026-11-11): 133 of 134 cases passed (99.3%), and Seri's first word came 0.55 s after the request (median), 90% within 0.68 s, measured from a laptop. Next best: `gpt-5.4-mini` with reasoning off, 94.8% at the same speed; `gpt-5-mini` 85.8% and slower; `gpt-4o-mini` 79.9%. The smaller models' commonest fault was saying goodbye without taking the action. The instructions' shared first part is sent with a cache key and was read from OpenAI's cache 87-95% of the time.

**Checked on Twilio's ConversationRelay docs, 2026-11-11** (what later tickets rely on):

- When `<Connect>` ends, Twilio requests its `action` URL with `SessionStatus`: `ended` (we ended it, with our `HandoffData`), `failed` (with `ErrorCode`), or `completed` (the caller hung up).
- The WebSocket request carries Twilio's signature (`X-Twilio-Signature`), as every webhook does. `<Parameter>`s inside `<ConversationRelay>` arrive in the `setup` message under `customParameters`.
- `events="speaker-events"` sends `agentSpeaking` and `clientSpeaking` messages - how the server knows when Seri has stopped talking. Their exact shape is checked in A02.
- `dtmfDetection="true"` sends key presses over the WebSocket.
- **Not documented:** whether `end` waits for Seri's last words to be heard or cuts them off. A02 finds out.
- **Before the first call:** the Twilio account must complete ConversationRelay's onboarding in the console, which includes accepting Twilio's AI features addendum. Until then a `<ConversationRelay>` call fails.

---

## 2. The AI runs the whole call

Decided by Jeel, 2026-11-11, reversing the earlier "keep the script, hand off when off-script" (2026-11-04):

- The hybrid could not help the **82 who hung up** - most did so during the robotic opening, before saying anything.
- The script's Kore voice and Seri's ElevenLabs voice would change mid-call.
- The client had asked for it ("run from start", 2026-11-05).

### What changes, what stays

| | With the AI on |
|---|---|
| Lead picks up | `/auto/answer` connects the call to Seri (`<Connect action="/auto/ai-after"><ConversationRelay welcomeGreeting="Hi, is this John?"/></Connect>`) instead of asking the script's Q1 |
| Voicemail | **Unchanged.** Twilio's machine detection runs as today; a beep replaces the call with the voicemail message (`onVerdict`, T18). Until the verdict has come, an action that would end the call waits (A18), so a greeting such as "he's not available" is never taken for the lead saying no |
| "Stop" | Seri's `opt_out` action - and a check of every lead turn, independent of the AI: the script's stop words (`call_scripts.opt_out_words`) or key 9 end the session as an opt-out even if the AI misses it |
| Transfer, hold line, busy line, link text | **Unchanged.** Seri's action ends the session, and `/auto/ai-after` runs today's code |
| Today's script | Kept, only as the backup (section 6) |

---

## 3. The sales playbook and Seri's five actions

### How a call goes

| Stage | What Seri does |
|---|---|
| Opening | "Hi, is this John?" (lead's first name; "Hi there" without one), said as the `welcomeGreeting`. Then who she is and the offer: up to 25% off the first order |
| **Yes** | Asks **when** they want to talk to someone. "Now" → a person, if anyone is there (below). "Tomorrow at 3" → book a call back |
| **No** | Asks why, once, like a salesperson. Offers the other products (STI treatments, test kits), then the link. After **two clear no's**, thanks them and ends |
| A question | Answers from the approved answers, then back to the offer |
| **Doesn't know the answer** | **Never** "I don't know" or "I can't answer that." Says "That's a great question. Let me connect you with one of our specialists who can help with that," then transfers - or, with nobody there, books a call back |
| Medical question, upset caller | Same: a specialist now, or a call back (the client, 2026-11-05) |
| "Stop calling me" | Opt out, every time |

How she talks, the nine objections and what she never does are in `backend/src/ai/knowledge/sales-playbook.json` (section 5).

### Who is there - told to Seri on every turn

Decided by Jeel, 2026-11-11. Before each reply the server works out who could take the call now, with the same rules the transfer and the hold line use (`FREE_SQL`; who is coming, T17), and tells Seri:

| The server sees | Seri |
|---|---|
| **Someone free** | Offers a person now → `transfer_to_agent` → the lead's own agent first, then everyone free (T15) |
| **Nobody free, but someone coming** - on a call, writing its note, or ringing with another lead | `transfer_to_agent` all the same → the hold line, as today (T16, T17) |
| **Nobody at all** | No transfer. Offers a call back time instead → `book_callback`, in place of today's busy line |

If it changes between her words and the transfer, the transfer's own rules decide, as today: the hold line, or the busy line and **Wants a call** in the queue (T22).

### The five actions

Seri ends every call by choosing exactly one. She says her last line herself, in her voice; then our server ends the ConversationRelay session with the action in `handoffData`, and Twilio posts to `/auto/ai-after`, which carries it out with today's code and says nothing more of its own - only the recording notice before a transfer, and the hold or busy line when today's transfer reaches them:

| Action | When | Seri's last line | What `/auto/ai-after` does | `script_result` |
|---|---|---|---|---|
| `transfer_to_agent` | Wants to order now, or wants a person - and someone is free or coming | "Great, connecting you now." | The recording notice, then `planTransfer`: own agent first, then everyone free, then the hold line or the busy line (T15-T17) | `transferred` / `transfer_missed` |
| `book_callback` | Wants a call later, or nobody is there | Confirms the time in the lead's own zone, says goodbye | Saves the callback (section 4), hangs up | `callback_booked` (new) |
| `send_link` | Wants to look for themselves | Says the link is on its way, says goodbye | Texts the link (T14), hangs up | `link_sent` |
| `opt_out` | Asks not to be called | The script's stop line ("Okay, we will not call you again...") | Blocks the number (T13), hangs up | `opted_out` |
| `end_call` | Not interested, wrong person, an emergency, done | Goodbye | Hangs up. The reason she gave is kept with the action | `not_interested` |

The relay waits for Twilio to say Seri has finished speaking (`agentSpeaking` off) before it ends the session, so her last line is never cut off (A02 confirms how).

Seri has no action for payment, personal details (date of birth, address, card) or prescriptions, so she cannot do them.

*As built (A06, 2026-11-11):* `backend/src/ai/actions.ts`. The five are OpenAI tools in strict mode: `book_callback` takes the time on the lead's own clock ("2026-11-12T15:00"), their IANA zone and a one-line reason; `end_call` a reason from a list - `not_interested`, `wrong_person`, `emergency`, `other`; the other three nothing. `toHandoff` checks a tool call against the turn's view of the call: a call back outside the hours, past, too soon or too far, and a transfer when nobody is there, come back to Seri as words saying what to offer instead ("Offer tomorrow at 1 PM your time instead, and if they agree, book it as 2026-11-12T13:00."), and the call goes on. The handoff is JSON - `{"action":"book_callback","at":"<instant>","timeZone":"America/New_York","reason":"..."}` - and `fromHandoff` reads Twilio's `HandoffData` back, keeping only what it knows: anything missing or unreadable is a `fallback`, never an error.

**Two rules the answer test set led to (A09):** the lead always hears a last line - when Seri takes an action with no words, the relay says the action's own in her voice, and an opt-out always ends with the stop line (`lineToAdd`); and an action in a reply that ended on a question is held back - the lead answers first (`toHandoff`'s `awaitLead`).

**Not an action Seri picks:** `fallback`, which the relay ends with when she fails (section 6). `/auto/ai-after` then asks the script's Q1 question - not its greeting, since Seri has introduced herself - and the call goes on as today.

---

## 4. Calls back at a time the lead picks

Decided by Jeel, 2026-11-11.

| Step | What happens |
|---|---|
| Seri books it | The time and a one-line reason ("Wants to order antibiotics") |
| Who it belongs to | The lead's own agent, if one holds the lead. Otherwise **open to everyone** |
| Before it is due | The lead's page shows "Callback booked: Thu 3:00 PM" |
| When it is due | Top of the queue as **Callback · 3:00 PM**; the first agent to open the lead takes it |
| Nobody calls | Stays at the top as overdue until someone does |

**Seri's two rules when booking:**

1. **Agent hours only:** weekdays 11 AM to 5 PM Arizona, the robot's own calling hours (`auto_call_*` settings, read by `readCallHours`). "8 PM tonight" → "Our team is available weekdays 11 to 5. Would tomorrow at 11 work?"
2. **The lead's time zone:** worked out from the area code, and confirmed out loud: "So that's Thursday at 3 PM your time?" Agents see it in Arizona time - Arizona keeps no daylight saving, so 3 PM in New York is 1 PM there in winter and 12 PM in summer.

*As built (A07, 2026-11-11):* `backend/src/ai/callback-time.ts`, pure. `leadTimeZone` maps 353 area codes to a zone - a code across two zones takes the one most of its people are in - and an unknown one gives Arizona's zone with `known: false`, so Seri asks. `checkCallbackTime` accepts a time inside the hours, at least 15 minutes and at most 14 days ahead; refused, it says why (`past`, `too_soon`, `too_far`, `outside_hours`) and offers what a salesperson would: a weekend keeps the time on the lead's clock (Saturday at 3 → Monday at 3), a time outside the hours becomes the next opening (8 PM → tomorrow at 11 Arizona), past or too soon the first quarter hour far enough ahead, too far the same time on the last day in reach. `atLocalTime` reads the wall clock Seri gives ("2026-11-12T15:00") in a zone, one instant whichever clock it was said on. `spokenTime` says it back: "tomorrow at 1 PM your time", "Monday at 3 PM your time", and the date from a week on. Holidays are not known, as they are not to the robot's own hours. The ticket: `ai-agent-tickets/A07-call-back-time-rules.md`.

**In the database:** `callbacks.agent_id` becomes nullable for a callback Seri books (today it must name an agent - migration 001), with a new reason `ai_booked` beside `booked` and `missed_call` (migration 008). The queue and My Callbacks read it as above. The new result, `callback_booked`, shows on the lead's timeline and in Admin > Leads' Call column and filter like every other result (A15). A "yes" that was put through and that nobody took still uses today's **Wants a call** rule (T22).

---

## 5. What Seri knows

Three JSON files, built 2026-11-11 from the client's emails and a crawl of edrugstore.com, all approved by Jeel:

```
backend/src/ai/
  knowledge/
    answers.json           10 rules, 37 spoken answers (36 approved, 1 open)
    products.json          30 products Seri may name: 7 antibiotics, 4 STI antivirals, the Emergency Medical Kit, 18 test kits
    sales-playbook.json    how Seri talks, 9 objections, closing questions, what she never does
data/edrugstore-site/      the crawl: reference only, never read by the app
```

**Files, not database tables** (Jeel, 2026-11-11). Nobody edits answers from a screen, and every change goes through a PR either way, so tables would add a migration, a loader and a database for the test set, and buy nothing. Not shown on Admin > Configuration either.

- **Loaded when the app starts.** A missing file, a missing field or a bad version stops the API from starting, and the tests catch it before a deploy.
  *As built (A03, 2026-11-11):* `backend/src/ai/knowledge.ts` imports the three files - so the build carries them into `dist/` - and `loadKnowledge()` checks them once and hands them out typed. Every problem in every file is listed, each by file and field (`answers.json: answers[id=price].answer is missing`); `api/index.ts` logs each as `api.refused_start` (`reason: ai_knowledge_invalid`) and exits, whether or not the AI agent is on - a broken file is a bug in the repo. Checked: every field present and not empty; ids and product slugs used once; `status`, product `type` and `rx_required` from their lists; product URLs `https://`; one shared version; an open answer has its `fallback_answer`; no placeholder but `{callback_number}` in anything Seri says. **Two things never get past the loader:** a product's price (the typed product has no field for one), and an open answer's own text (an answer's `spoken` is its `fallback_answer` until it is approved). `api.started` names the version.
- **One version** for all three (`approved-2026-11-11`). Every AI call saves it, so what Seri knew on any call can be traced.
- **All of it goes into Seri's instructions on every call** - about 3,300 words. No search and no vector database, so an approved answer is never missed. The part that never changes comes first and the call's own details (the greeting, first name, time, the lead's time zone, the hours) last, so OpenAI can reuse what it has already read and start faster. Who is there is not in them: it changes during the call, so it comes with each of the lead's turns (section 3, A11).
  *As built (A04, 2026-11-11):* `backend/src/ai/instructions.ts`, pure: `buildInstructions({ knowledge, lead, now, hours, callbackNumber, stopLine })`. In order: who Seri is and her goal; how she speaks; how the call goes; the three notes of who is there; her five actions with their last lines - the opt-out's is the script's own stop line; the rules and "never"; the objections; the closing questions; every answer by topic, `{callback_number}` read digit by digit (`spokenNumber`, shared with the voicemail); the products by type, names and spoken lines, no price and no web address. Then, under "## This call": the greeting already said, the first name (cleaned - `cleanFirstName`), the time in Arizona, the lead's zone and their time, and the agent hours in both. Every call on one server shares its first 18,000 characters. Two lines are not from the files and wait for Jeel's word: Seri says she is eDrugstore's virtual assistant if asked whether she is a person, and an example opening. `welcomeGreeting` and `whoIsThereNote` live here too, for A13 and A11. The ticket: `ai-agent-tickets/A04-seri-s-instructions-system-prompt.md`.
- **Changing anything:** edit the file, bump the version, run the answer test set (section 8), PR into `dev`. Never edit on the server. The instructions' snapshot test fails on any change, so the PR shows the new text; `npx jest -u src/ai/instructions` writes it once read.

**The rules inside the files:**

- **Seri never quotes prices**, even though `site_price_usd` is stored for reference. It never reaches her instructions.
- An answer's `status` is `approved` (from the client or Jeel) or `needs_confirmation`. One that needs confirmation carries a `fallback_answer`, which is what Seri says until it is confirmed. Only `medical_web` is open (section 11).
- `{callback_number}` in an answer is the number the call came from (`TWILIO_PHONE_NUMBER`), read out digit by digit as the voicemail reads it (`voicemailLine`, T18): production's (480) 470-8259 on the server, the dev number on a laptop.

**Where it came from:** the client's emails of 2026-11-05 (goal, rules, delivery, what not to do) and 2026-11-09 (call questions, objections, products, the offer); edrugstore.com, crawled 2026-11-09 (FAQ, policies, product pages); Jeel's updated legal, safety and privacy wording, and his approvals, 2026-11-09 and 2026-11-11. Each answer names its source.

**The crawl** - `data/edrugstore-site/`, the material the files were written from. **The app never reads it.**

| File | What |
|---|---|
| `site-products.json` / `.csv` | All 186 products on the site: name, category, price, Rx flag (a first guess), description, URL |
| `pages-index.json` | All 576 crawled pages, tagged product, category, info, doctor profile or home |
| `raw/edrugstore-site-crawl.json` | The full crawl, 13 MB. Git-ignored: regenerate rather than commit |

Crawled through a browser from the site's sitemap (blog posts not included). Two pages failed: `/bundles/` and one doctor profile.

**All AI code lives in `backend/src/ai/`** - the switch, the relay, the instructions, the safety check, the test set. Nothing AI-related goes anywhere else in `src/`, apart from the hooks into `/auto/*`, the worker, the queue, and the server command in `src/cli/` that switches it (section 7).

---

## 6. Limits and backups

Decided by Jeel, 2026-11-11.

| Situation | What happens |
|---|---|
| Conversation reaches **3 minutes** | Seri wraps up: offers a person or the link once, then ends. No limit on the number of questions |
| Lead silent **6 seconds** after Seri stops talking (`agentSpeaking` off) | "Hello, are you still there?" Silent again: "Sorry I missed you, have a great day," and the call ends |
| OpenAI gives no first word in **4 seconds** | Seri says a filler ("One moment..."); still nothing, the call **switches to today's script** |
| OpenAI errors, or the WebSocket or ConversationRelay fails mid-call | The call **switches to today's script** (Twilio posts `SessionStatus=failed` to `/auto/ai-after`) |
| **OpenAI down before calling** | **The robot places no calls.** Before each look for leads to call, it checks OpenAI (a tiny request, at most once a minute). Down: nobody is called, it checks again next minute. Each lead gets one robot call, so a lead is never spent on a broken AI |
| 3 AI calls fall back in a row (`calls.ai_ended_with = 'fallback'`) | The robot pauses, like the Twilio pause (T28, `REFUSED_PAUSE_MINUTES`), then checks OpenAI again |
| A sentence holds a price, medical advice or a made-up discount | **Every sentence is checked before Seri says it.** A price (`$`, "dollars"), advice words ("you should take", "dosage"), or any discount but "up to 25%" is replaced with "That's a great question for one of our specialists. Would you like me to connect you?" Every approved answer and playbook line passes the check unchanged (A05). *As built:* `backend/src/ai/safety.ts`, `checkSentence` - four reasons, `price`, `advice`, `diagnosis`, `discount` (made-up urgency such as "today only" counts as one); the words around a risky word decide, so "I can take you off our list" and "an overdose" pass; what it found is kept with the call's turns, never logged. All 116 lines of the knowledge files pass, sentence by sentence |
| Someone else connects to the WebSocket | The connection request must carry Twilio's signature for our relay URL, checked like every Twilio webhook. The call is named by a `<Parameter>`, which arrives in `setup`. Unsigned, or signed for another URL: closed |

---

## 7. Switches and rollout

| | Where | What |
|---|---|---|
| `OPENAI_API_KEY` | Server `.env` (and local), passed to the api and the worker | From the client, 2026-11-09. Never in the repo. **Without it the AI agent is off, whatever the switch says** |
| **AI agent on/off** | `settings.ai_agent`, changed only by `npm run ai-agent -- on` or `-- off` | On: Seri runs every call. Off: today's script. **Read on every call, so it changes without a restart** - switching it off at 2 PM cuts off no live call |

**As built (A01, 2026-11-11):**

- **The switch is a server command** (Jeel, 2026-11-11), not a hand edit: production's database is changed only by migrations and by the app itself (`WORKFLOW.md`, "Migrations"). On the server: `docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api npm run ai-agent -- on`; locally, `docker compose exec api npm run dev:ai-agent -- on`.
- **Each change is recorded** - `ai_agent.switched` in the activity log, with what it was and what it became, in the same transaction as the change (`AUDIT.md`). Switching it to what it already is changes nothing and records nothing. Two commands at once take turns.
- **`on` is refused without `OPENAI_API_KEY`**, and nothing is written.
- **On without a key counts as off** - the key was taken out of `.env` after switching on, say. Calls go to the script, and the first such call logs `ai_agent.no_key` once.
- **Not a reason to refuse to start**, unlike a half-set Twilio group (`api/startup-checks.ts`): the switch changes while the API runs, so a startup check would catch it only at the next restart - and would take down the queue, the texts and every screen for something whose fallback is today's script.
- The code: `backend/src/ai/settings.ts` (reading and writing the switch), `backend/src/cli/ai-agent.ts` (the command); the key is `config.openai.apiKey`, passed to the api and the worker by `docker-compose.yml`.
- **Packages:** `openai` 6.x and `ws` 8 (with `@types/ws`). `openai` 7 needs Node 22, and the app runs Node 20 (`node:20-alpine`), so it stays on 6 until Node is upgraded - a change of its own.

**Rollout** (Jeel, 2026-11-11): no partial share, no comparison report.

1. Build and test on the dev number, (480) 530-8582, as much as possible
2. Deploy with the AI **off**: calls work exactly as today
3. Switch it **on** with the command: every call goes to Seri

Outside production the robot already rings only `AUTO_CALL_TEST_NUMBERS`, so Seri can only reach our own phones while testing.

Analysis of how calls went is done by hand when wanted: every turn is in the database (section 9), queried on the server.

---

## 8. Testing

| Level | What |
|---|---|
| Unit | Pure functions in `backend/src/ai/`: the switch, the instructions, the sentence check, action to `handoffData`, booking times and time zones, the 3-minute and silence rules. No OpenAI, no Twilio |
| WebSocket | The relay against a fake ConversationRelay and a fake OpenAI: setup, turns, each action, an interruption, a stop word, a timeout, a failure |
| **Answer test set** | About 60 things leads say ("is this a scam", "how much", "I'm driving", "call me tomorrow at 3", "what should I take for a UTI", "stop calling"), each with the action that must follow and words that must not appear. Run against the real model before every change to the knowledge or the instructions: `npm run ai:eval`. The model is chosen by it (speed and answers). *As built (A09):* 67 cases in `backend/src/ai/evals/cases.json`, marked by `grade.ts` - the outcome checked as a call checks it, the words she must and must not say, and the sentence check. `cd backend && OPENAI_API_KEY=... npm run ai:eval` runs Seri's model; `-- --model gpt-5.4-mini:none --runs 2` compares. `gpt-4.1-mini`: 133 of 134, first word 0.55 s. The results and what each run changed: `ai-agent-tickets/A09-answer-test-set.md` |
| End to end | `npm run e2e` gains robot calls that go to Seri, with Twilio and OpenAI stubbed at their edge |
| Real phone | Every action, talking over Seri, silence, a voicemail, a hang-up, OpenAI switched off mid-call, on the dev number |

---

## 9. What is stored

Following `docs/AUDIT.md`: nothing is lost, add-only.

| Where | What |
|---|---|
| `calls.ai_started_at` | When Seri took the call. Null for a script call |
| `calls.ai_knowledge_version` | Which knowledge version she used |
| `calls.ai_ended_with` | How her part ended: one of the five actions, or `fallback`. Null when the lead hung up first. A fallback call then gets the script's own `script_result`, so this is the only record that Seri failed (A17 counts it) |
| `calls.script_result` | Adds `callback_booked` |
| `call_ai_turns` (new) | One row per turn: call, who (lead, Seri, action, system), the text, when, how long Seri took to start |
| `callbacks` | Seri's bookings: no agent until taken, reason `ai_booked` |
| `activity_log` | `ai_agent.switched` (built, A01); `ai_agent.started`, `ai_agent.ended` with the action |

The words are never written to the logs, the same rule as `auto_call.answer` today.

*As built (A08, migration 022, 2026-11-11):* the columns and the table above, with the database keeping their rules - `ai_started_at` and `ai_knowledge_version` written together, `ai_ended_with` only after a start, all three only on an automated call; `call_ai_turns` add-only by trigger, `who` one of the four, `latency_ms` only on Seri's turns; a callback with no agent only when it is `ai_booked`, and every `ai_booked` one naming its call (`booked_by_call_id`); and `settings.ai_agent` seeded `off`, never over a value the command already wrote. `scripts/ai-agent-live-check.ts` proves each rule, 34 checks.

**On screen:** under the robot call on the lead's timeline (T21, `CallAnswers`), Seri's conversation as a short chat: what the lead said, what Seri answered, how it ended. It is there for **the agent** who takes the transfer or the call back, so the lead does not repeat themselves. Nothing new on Admin.

---

## 10. Not in this phase

- A self-improving AI (why leads hang up or say no) - a future phase
- Seri answering a lead calling back when nobody is free, or off hours
- Taking payment or personal details, ever
- Languages other than English

## 11. Open

- "What is Medical Web?" (the caller ID name): until confirmed, Seri says only `medical_web`'s `fallback_answer`, "We're calling on behalf of eDrugstore."

---

## Build tracker

The build is split into 22 small tickets, A01 to A22, one PR into `dev` each: **`docs/ai-agent-tickets/README.md`** has the list, the order and each ticket's status. Each ticket says what to build, which files, what done means, the tests and the docs to update.
