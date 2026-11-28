# Seri's brain: understand, decide, speak

Each of Seri's replies on a call is made in three steps: OpenAI **understands** what the lead just said, as short labels; tested code **decides** what she does next, from a record of the call; and OpenAI **speaks** it in her own words - the client's approved answers and her introduction said by code, word for word. The brain is one object per call, `Brain` in `backend/src/ai/brain.ts`, with `understand.ts`, `policy.ts` and `speak.ts`, and OpenAI reached only through `openai.ts`. Everything around it - the stop check, every sentence checked, being talked over, the limits, the voicemail wait and how her part ends - is the call's, [AI-AGENT.md](AI-AGENT.md).

## How it works

```
the lead's words (Twilio)
  ├─ a stop, or key 9 ─────────────► the call's own stop check: opted out, no brain (AI-AGENT.md)
  └─ who is there (database), then the brain:
       1. READ     what the lead heard of her last reply → the record
       2. UNDERSTAND  a bare "yes" or "no" to her yes-or-no question → no OpenAI
                      anything else → OpenAI, short JSON labels - often already started
                      on the words while the lead was saying them
       3. DECIDE   the record and the labels → her moves (code, tested)
       4. SAY      approved answers and her introduction → by code, at once
                   the rest → OpenAI streams her words → each sentence checked → Twilio
                   an ending → its action, checked again by the call
```

The brain sits behind the same interface the call already asks for a reply, `SeriModel` (`openai.ts`): it is handed the call's history and gives back her words as they are written, then her action if the reply ends the call - or `quiet`, nothing to say on purpose. It is wired in `backend/src/api/index.ts`, one per call, with the understand and speak requests built from `OPENAI_API_KEY`.

### 1. Reading the call

Before each reply the brain reads, from the call's own history, what happened since its last one:

- **What the lead heard of her last reply.** The call keeps only what Twilio says was heard when she is talked over (`AI-AGENT.md`, section 1). Heard whole, or at least 60% of what she was given to say (`HEARD_MOST`), every move of it counts; cut off sooner, what she stated counts but not a question they barely heard - except the opening, which counts once any of it was heard, and the time said back, which counts as asked. Nothing heard: the decision is dropped. `markSaid` (`policy.ts`) adds to the record only those moves, so an offer cut off before it was made was never made.
- **The time said back, talked over before the time itself** counts as asked but `unheard`: a "yes" to it has her say the time again, never books it.
- **A sentence the safety check replaced** with the specialist line: the conversation puts a marker in the history (`REPLACED_NOTE`), and the record keeps the approved answers said before it, then the line itself and its question - a person offered with someone there, a call back asked for with nobody (`saidWithSpecialistLine`). The ending she had decided does not count.
- **An action the call refused** (a tool note in the history): the policy was wrong. Its ending never counts, the next reply is decided with no acts - the policy's safe move - and `ai_policy.guard` is logged.
- **The three minutes** (`WRAP_UP_NOTE` in the history): the record marks the closing offer due (`wrapUpDue`).
- **Who is there**, from the note on the lead's last turn wherever it is - `[Who is there: someone free]` (`whoIsThereNote`, `instructions.ts`). The call reads it from the database before it asks the brain (`AI-AGENT.md`, section 3), one after the other: a database read is quick beside OpenAI's second or so, and the understand step has often started already.
- **How often her replies since the greeting said the lead's name** (`timesNamed`) - the greeting is one, so after one more the brief says not to say it again.

### 2. Understand

`understand.ts` builds the request; `openAiUnderstand` (`openai.ts`) asks `gpt-5.4-mini` with no reasoning, for strict JSON (`understandFormat`).

- **The answer** is the acts in what the lead just said, each once, in the order said, as short labels: the plain acts (`confirm_identity`, `interested`, `not_interested`, `not_now`, `wants_person`, `wants_callback`, `wants_link`, `agrees`, `declines`, `emergency`, `wrong_person`, `stop`, `unclear`, `checking_line`, `repeat`, `backchannel`, `machine`, `other`), `asks:<answer id>` - or `asks:uncovered`, `asks:real_person` - and `objection:<id>`. A no carries its `reason` - `closed`, `timing` or `product`; a call-back time carries the parts the lead said - day as said, hour, minute, AM or PM - never a date the model worked out. `not_interested` and `wrong_person` are plain acts, not objections, so each has one label. `parseActs` refuses anything else.
- **The prompt**'s first part is the same on every call and turn - what each label means, the answer ids with three sample questions each, the objection ids with what leads say (`understandSystem`) - so OpenAI keeps it read (`prompt_cache_key`). Then the turn: up to four turns before, what Seri just said, what the lead just said. Its definitions say, among others: label only the line just said; read a misheard line as most likely meant, and one that still makes no sense where it comes as `unclear`; a question is always `asks`, never `other`; who runs the company or who will call back is `asks:uncovered`; wanting to look on their own first is `objection:think_about_it`, not `not_now`; "I don't want to talk" to an offer or to "When would be a good time?" is `declines`; "I want to talk with you", said to Seri, is not `wants_person`; a voicemail's greeting or menu is `machine`.
- **The fast path** (`fastPath`): a bare "yes" or "no" - "Uh, yes please.", "No thank you." - to one of her yes-or-no questions is read without OpenAI. "Okay" never is.
- **Started early** (`Brain.prefetch`): with `partialPrompts` on, Twilio sends the lead's words while they are still speaking. Once they have stayed the same for 150 ms (`PREFETCH_SETTLE_MS`), the understand step is asked about them, exactly as the reply would ask it. When the final words match - small letters, no punctuation - the reply uses that answer, often already back (`understood: "early"`); when they differ, it is dropped and the final words asked as before. A bare yes or no starts nothing; newer words drop an older start; the reply stopping - talked over, too slow, the call closed - stops it too, and nothing more is decided.
- **An answer it cannot read** is a line not made out: `unclear`, and she asks them to say it again (`ai_brain.unreadable`). **OpenAI failing** throws, and the call falls back to the script (`AI-AGENT.md`, section 6).

### 3. Decide

`policy.ts`, pure: no OpenAI, no database, no clock of its own.

- **The record** (`CallState`): the stage (greeting, talking, closing); whether they said it is them; their interest; how many clear no's; whether she asked why; each offer - a person, a call back, the link, the other products - how often made and its answer; her open question; the call-back day named and the time said back; lines misheard in a row; how often each approved answer and the specialist line were given; whether "everyone is busy" was said; whether a question was a specialist's; how many replies since she came back to her question; whether she asked "anything else?"; the three minutes; how her last two replies began.
- **`decide(record, acts, context)`** - the context is who is there, the time, the agents' hours, the lead's zone from the area code, and the knowledge - returns her moves for the reply and the record with what the lead did. The moves: `opening`, `answer` (said by code, or briefly in her words when asked again), `specialist`, `virtual`, `objection` (worded from its `approach`), `ask_why`, `offer`, `busy`, `ask_time`, `confirm_time`, `ask_repeat`, `still_here`, `say_again`, `which_next`, `return_to`, `anything_else`, and `end` with its action. No moves at all: she says nothing and listens on. The rules it keeps are below, "Rules".
- **A call-back time is worked out here, never by the model** (`resolveTime`, `timeMoves`): the parts the lead said, on their own clock - no AM or PM read as people mean it, 8 to 11 the morning, 12 noon, 1 to 7 the afternoon; no day named, today if the time is still ahead, else tomorrow - then checked by `checkCallbackTime` (`callback-time.ts`, `AI-AGENT.md` section 4).
- **`markSaid(record, moves)`** adds what she said, once the lead has heard it; `markOpening` keeps the first two words of each reply, for speak.

### 4. Say

- **By code first** (`codeLines`, `speak.ts`): each approved answer exactly as the client wrote it, in a tone chosen for it, `{callback_number}` read digit by digit (`answerLine`); then her introduction, `OPENING_LINE`, when nothing else in the reply needs her words - a bare "Yes." to the greeting, or an approved answer and the introduction:

  > This is Seri from eDrugstore, calling about our offer of up to 25% off your first order. Would you like to hear more about it?

  With anything speak must word - "Yes. Who is your CEO?" - speak words the whole reply, the introduction included, so her one question stays the last thing she says.
- **Then speak**, when a move needs her words (`needsSpeak`): `openAiSpeak` streams `gpt-4.1-mini`, with no tools - she decides nothing. Its messages (`speakMessages`):
  - **her persona** (`speakSystem`), the same on every call on a server up to the call's own details, so OpenAI keeps it read: who she is; that what she does is already decided and she only words it; the playbook's style; "up to 25% off your first order", exactly so; never that she doesn't know, can't answer, or don't have it; never the same sentence twice; her tones; the rules and the never list; the products she may name; and the call's own details (`callPart`, `instructions.ts` - the time, the lead's zone, the agents' hours, and the next days that have hours, a weekend tomorrow said plainly);
  - **the last six turns**, plain words, no tones; then what code has already said of this reply, as her own words - without it she answered the lead's question again after the approved answer;
  - **the brief** (`replyBrief`): the moves in order, each a plain instruction with its facts (`moveBrief`) - "Say the time back as a question, in exactly these words for the time: "tomorrow at 2 PM your time""; with nobody free, never offer to connect anyone or mention who is free; "This is your last line: no question in it." for an ending, else at most one question, last; how her last two replies began; her name already said; "everyone is busy" already said; and, on every reply but the opening and her question about the offer, that they have already heard the offer.
- **An ending**: in a reply that ends the call, a sentence with a question in it is never said. Then the action, handed to the call as a tool call - the call checks it again (`toHandoff`, `AI-AGENT.md` section 3) before it is taken. An opt-out the understand step read in words the stop check does not catch needs no speak: the call says the script's stop line.
- **Nothing to say** - a voicemail's greeting, an "okay" with no question open - is `quiet`, so the call does not warn of an empty reply.

### The models

| Step | Model | Chosen because |
|---|---|---|
| Understand | `gpt-5.4-mini`, reasoning `none` (`UNDERSTAND_MODEL`, `UNDERSTAND_EFFORT`) | The fastest to a whole answer of eight models; on the labelled lines 94.5% over three runs, every stop, wrong person and wanting a person read right. `gpt-5.6-terra` read 95.8% but 0.16 s slower on every turn that needs both steps; `gpt-5.6-luna` 94.2%, with two of 16 "wants a person" wrong; `gpt-4.1-mini` 92.1% in 0.70 s; `gpt-5.4-nano` 79.9% |
| Speak | `gpt-4.1-mini` (`SERI_MODEL`) | The fastest to a first word (0.52 s), and the model A21's real calls shaped her voice and tones on |

Both are in `backend/src/ai/model.ts`, each asked with a cache key so the part of the request that is the same on every call stays read (`UNDERSTAND_CACHE_KEY`, `SPEAK_CACHE_KEY`). The robot asks both before it places calls (`openAiProbe`, `AI-AGENT.md` section 6).

### How fast

OpenAI's own time, measured 2026-11-17 from a laptop over 194 lead lines - the answer test set's last lines and A21's real ones - every way of asking shuffled together, 3,298 requests (A24):

| Step | Model | Median | Slowest tenth |
|---|---|---|---|
| The one-request brain it replaced (first word or action) | `gpt-4.1-mini` | 0.61 s | 0.81 s |
| **Understand** (the whole answer) | `gpt-5.4-mini`, no reasoning | **0.71 s** | **0.87 s** |
| | `gpt-5.4-nano` / `gpt-4.1-mini` / `gpt-5.6-luna` / `gpt-5-nano` (minimal) | 0.76 / 0.77 / 0.78 / 0.80 s | 0.99 / 1.02 / 0.96 / 1.00 s |
| | `gpt-4o-mini` / `gpt-5.6-terra` / `gpt-6-luna` | 0.86 / 1.05 / 1.05 s | 1.07 / 1.30 / 1.43 s |
| **Speak** (first word) | `gpt-4.1-mini` | **0.52 s** | **0.61 s** |
| | `gpt-5.6-luna` / `gpt-6-luna` / `gpt-5.4-mini` / `gpt-5.5` / `gpt-5.6-terra` | 0.55 / 0.61 / 0.63 / 0.70 / 0.78 s | 0.74 / 0.86 / 0.84 / 0.89 / 1.01 s |
| Both, one after the other (first word) | `gpt-5.4-mini` + `gpt-4.1-mini` | 1.21 s | 1.44 s |
| One request writing labels, move and words (the words' first character) | `gpt-4.1-mini` | 0.83 s | 1.09 s |

Not every turn needs both steps: of A21's 103 real lead lines, 39 were a bare yes or no (speak alone) and 20 a question with an approved answer (understand alone, the answer said by code); only 44 needed both. Timed that way, 0.75 s median and 1.36 s at the slowest tenth. On a real call our server, the first sentence being whole and Twilio come on top (`AI-RELAY.md`, "Timings"): on A34's calls her replies mostly started 0.4 to 3.0 seconds after the lead's words reached us, most of it OpenAI's own time, which changes from minute to minute. The head start from the partial words saves at most the gap before Twilio's end of turn, about a fifth of a second; her introduction after a bare "Yes." is said 12-16 ms after the words, by code.

### Picking a call back up

When the line drops and the call is picked back up (`AI-AGENT.md`, "When the line drops"), the brain starts from the last record kept (`recordFromTurns`): with its reply counted as said if her turn followed it - not "One moment...", not "are you still there?", and not a reply Twilio said nothing of - else as it stood before that reply. A record from another version of the policy (`POLICY_VERSION`), or none, starts past the opening, the lead confirmed, no question open.

## Rules

What the policy holds on every reply (`decide`, `policy.ts`). Each is a test in `policy.test.ts`.

1. **First, whatever else was said:** a stop ends the call as an opt-out; an emergency gets the approved `emergency` answer and ends the call (`end_call`, `emergency`); a line that is only a voicemail's greeting or menu (`machine`) gets nothing - she says nothing, and the beep decides (`AUTO-CALL-SCRIPT.md`, "Voicemail").
2. **The wrong person only before they said it is them.** Said plainly, or a no to "Hi, is this John?", she apologises and ends (`wrong_person`). After they confirmed, such a line was misheard (rule 12).
3. **The opening once, at the start.** Any answer to the greeting gets the opening - a first question it does not cover answered first. Asking at the greeting for a person, a call back or the link, or "I'm busy", is answered as asked instead. Later, "Hello. Hello." is "I'm here" and her open question again.
4. **"Yes" to the greeting is not interest** - it says only that it is them. **"Okay" is never a yes:** her open question once more, then she listens.
5. **A yes:** with someone free or coming, an offer to connect, and a yes to that puts them through - a call back offered instead once they turned a person down. With nobody, "everyone on our team is busy" said once, then when would suit. Asking for a person puts them through at once with someone there; with nobody, the same busy and when.
6. **A no:** the first gets why, asked alone, nothing offered with it; another clear no ends the call (`not_interested`). A reason that leaves a door open gets one offer - the timing ("not right now"): a call back; not antibiotics in particular: the other products - and a no to it ends the call. A person turned down after a yes gets a call back instead; a call back turned down after a yes, the link once, counted as a no. A no to "What time?" is a no to the call back.
7. **A no said with a question is not a clear no:** the question is answered, the no kept on the record, and the call goes on - "anything else?" in place of the ending.
8. **"I need to think about it", "I want to look myself":** the link is offered, even when it is read as not now as well; only a plain no read with it goes the no's way.
9. **Questions:** an approved answer is said by code, word for word; asked again, briefly in her words. A question no answer covers is the specialists' to answer - never "I don't know" - and asked again, the same in new words. "Are you a real person?": she is eDrugstore's virtual assistant. At most two are answered in a reply; asked more at once, she says she will take them one at a time and asks which first.
10. **After an answer, one question to go on with.** After a question about their own health (`medical_question`, `which_medication`), the answer's offer first - a person with someone free or coming, a call back with nobody. Otherwise her open question, come back to once every three replies at most (`RETURN_EVERY`) - a question new to them may be come back to at once - else an answer's offer, else "anything else?", never two replies running.
11. **Offers by who is there, each once:** a person only when someone is free or coming; with nobody, a call back. An offer turned down or let pass is not made again.
12. **Misheard:** asked to say it again; twice, the link offered as a simpler choice - unless they turned it down; three times, a goodbye (`end_call`, `other`).
13. **"Say that again", "I don't understand":** her last reply again, more simply - the same facts, nothing new and no offer, ending with its question if it had one. A question beside it is answered instead.
14. **A call back:** its time worked out by code on the lead's clock and checked by `checkCallbackTime` - a weekend keeps the time on the lead's clock (Saturday at 3 is Monday at 3), a time outside the hours becomes the next opening - said back as a question ("So that's tomorrow at 2 PM your time?"), and booked only after a yes to it, with a reason from the record. A yes read as asking for the call back again books it all the same.
15. **A day said alone** ("How about Sunday?") is asked for a time only if that day has one a call back can be booked at (`bookableAt`, quarter hour by quarter hour on the lead's clock). If not - a day the team does not work, its hours over, or more than two weeks ahead - why first, then what time on the next day that has one.
16. **The three minutes:** with her next reply, the closing offer - a person if someone is free or coming and they have not turned one down, else a call back, else the link; then an ending.
17. **"Anything else?" - "No, that's all":** interested, a person offered - with nobody, when would suit; interest unknown and no person offered yet, back to the offer; otherwise a goodbye.
18. **The shape of a reply:** at most one question, and it comes last; nothing after an ending, and an ending never asks (`shape`).

## Data

- **The record of each reply** is one add-only `system` turn in `call_ai_turns`, text `Record of the reply (the brain)` (`RECORD_NOTE`), with its data in `call_ai_turns.data` - migration 024, only on `system` rows (`SCHEMA.md`). The data (`BrainRecord`): the policy's version; how the lead's words were read - `fast`, `openai`, `early` or `refused`; the acts as labels; the moves; and the call's record before the reply and once said whole. "Why did she say that?" is the row before her turn.
- **Not free of words:** an approved answer's text as code said it, the time said back and the time first asked for, the day named as a label ("tomorrow", "monday"), and the first two words of her last two replies (`openings`), which can be the lead's name. In the database like every turn, **never in the logs**.
- **Logged per reply**, without a word said: `ai_brain.turn` - how it was understood, how long understanding took once the lead had finished (`understandMs`), the partial words that came and the head start they gave (`partials`, `lastPartialMs`, `headStartMs`), how many acts, the moves, the action. Also `ai_brain.unreadable` and `ai_policy.guard` (`LOGGING.md`).
- The timeline and a call picked back up pass over the record, as over every `system` note.

## Code

| File | What it does |
|---|---|
| `backend/src/ai/brain.ts` | `Brain`, one per call: reads the history, understands, decides, says; `prefetch`, the early start; `recordFromTurns`, `saidWithSpecialistLine`, `RECORD_NOTE` |
| `backend/src/ai/understand.ts` | The understand step, pure: `understandSystem`, `understandMessages`, `understandFormat`, `parseActs`, `fastPath`, `actLabel` |
| `backend/src/ai/policy.ts` | The decide step, pure: `CallState`, `Act`, `Move`, `decide`, `markSaid`, `markOpening`, `wrapUpDue`, `resolveTime`, `POLICY_VERSION` |
| `backend/src/ai/speak.ts` | The speak step, pure: `speakSystem`, `replyBrief`, `moveBrief`, `speakMessages`, `answerLine`, `OPENING_LINE`, `codeLines`, `needsSpeak`, `timesNamed` |
| `backend/src/ai/openai.ts` | The one place a call reaches OpenAI: `openAiUnderstand`, `openAiSpeak`; `SeriModel`, what the call asks of the brain; `plainError` |
| `backend/src/ai/model.ts` | The two models and their cache keys |
| `backend/src/ai/instructions.ts` | The call's own details for speak (`callPart`), the greeting (`welcomeGreeting`), the lead's name made fit to say (`cleanFirstName`), the note of who is there (`whoIsThereNote`) |
| `backend/src/ai/callback-time.ts` | When a call back may be booked and how its time is said (`AI-AGENT.md`, section 4) |
| `backend/src/ai/evals/` | The understand and speak test sets, run by hand against OpenAI |
| `backend/scripts/ai-replay.ts` | Real calls replayed through the real conversation and brain |

## Tests

| What | Where |
|---|---|
| Every rule above, and every structural fault of A21's calls 86-112 | `policy.test.ts` |
| The brain inside the real conversation, OpenAI faked: the opening without OpenAI; "Hello. Hello." later never the opening; an approved answer word for word, then speak; with nobody free a call back, never a person; a yes put through; a call back said back and booked; a question in a last line not said; two no's ending; an offer cut off never counted; a voicemail greeting - nothing said; understand failing - the script; an unreadable answer - "say that again"; the record kept and resumed; the early start used, dropped, never asked for a bare yes; the lead hanging up while it runs - nothing decided or carried out | `brain.test.ts` |
| The labels, the prompt, the fast path; every label in the labelled set one OpenAI can write | `understand.test.ts` |
| The briefs, the code lines, the saved introduction - its tones, the safety check, one question, last; the name and busy notes | `speak.test.ts` |
| What the lead heard - "heard anyway", nothing heard after the reply all went out | `conversation.test.ts` |
| **The understand test set**: labelled lead lines - A21's and A34's real ones (the lead made John), the old answer test set's, and written ones - each with the acts it must be read as; the pass rate, how often a stop, the wrong person and wanting a person were read right, and the time to the whole answer. By hand, it calls OpenAI | `npm run ai:eval:understand` - `evals/understand-cases.json`, `evals/understand-grade.ts` |
| **The speak test set**: every kind of move, each with what her words must and must not hold, marked as the call says them - tones out, every sentence through the safety check - and the time to her first word; a case may set its own day and record. By hand | `npm run ai:eval:speak` - `evals/speak-cases.ts`, `evals/speak-grade.ts` |
| **Whole calls replayed**: each real call's lead lines, from a local export never committed (`--real`), said in order to the real conversation and brain against the real OpenAI, Twilio faked; checked for the rules that hold on any call - the opening once at most; an offer to connect never with nobody free, never two replies running; a call back booked only after the reply that said its time back; after two clear no's the call ended, a reply answering a question asked with the no allowed first; never "I don't know", "I can't provide that", nor "connect you" with nobody free | `npm run ai:replay -- --real turns.json --runs 10` |
| The brain end to end: OpenAI's stand-in answers understand with the acts each step scripts and speak with her words; the introduction by code with no OpenAI asked; the time said back before a booking; a call picked up from its kept record | `npm run e2e` |
| The record on a `system` row, kept and read back; refused on another row | `scripts/ai-agent-live-check.ts` |

## Not done

- **Lines still misread**, run after run: "Do you sell medication for my dog?" as nothing; "Who is the person available for me to talk on the Monday?" as the customer service number; "What is that?", "how do you know?", "Do you know my time?" - lines that need more than the last few turns. The names of who will call back and the CEO, and "Is it scam?", come and go between runs.
- **Repetitive, not a rule:** an answer asked for several ways is given several times, in new words but repetitive.
- **An offer of her own** - seen once on a real call (A34's call 129), never in the test set: the brief makes it less likely, but the policy cannot see it, and a yes to it is read against her open question. Likewise mentioning who is free when no move said to (call 135).
- **No approved answer says what an antibiotic is:** a confused lead asking gets "a licensed provider decides" - safe, not an explanation.
- **A voicemail's menu taken for an answer** on the script is A23's (`ai-agent-tickets/A23-a-voicemail-menu-is-never-put-through.md`); with Seri, a line read as `machine` already gets nothing said.
- **The one-request way** - labels, move and words in one request, 0.83 s - was not built: it is the fallback if the two steps prove too slow.
- **Hosted voice-agent platforms and OpenAI's voice-to-voice models** were not chosen: a second vendor, the transfer, hold line and audit trail rebuilt; no check of each sentence before it is said, and not Aria (`AI-AGENT.md`, section 1).

## Decisions

| Decision | By | Date |
|---|---|---|
| Each reply in three steps: OpenAI understands, tested code decides from a record of the call, OpenAI speaks - after each fix by a rule or a note had made a failure "less often, not never" | Jeel | 2026-11-17 |
| Two models: understand `gpt-5.4-mini` with no reasoning, speak `gpt-4.1-mini`; the slowest tenth about half a second slower than before, accepted for what she does next decided right every time | Jeel | 2026-11-17 |
| Understanding started early on the partial words, with no change to the model or the instructions | Jeel | 2026-11-17 |
| Flux's end of turn at 0.6, and the partial words kept | Jeel | 2026-11-18 |
| Her introduction a saved line, said by code - the one exception, with the approved answers, to her own words | Jeel | 2026-11-18 |
| The one-request brain removed before A34's checklist was through: a rollback is a revert, not a switch | Jeel | 2026-11-19 |
| "Licensed provider" is fine: our reps are licensed, or put the lead through to someone who is | Jeel | 2026-11-21 |
| One offer of the other products after "I don't need it", then a goodbye | Jeel | 2026-11-16 |
| A question asked with a second no is answered first (call 140) | Jeel | 2026-11-22 |

## History

- 2026-11-27 · Written from `AI-AGENT.md` section 12, "The brain: understand, decide, speak", and the brain's parts of section 1, "How a reply is made", to today's code; the call-by-call notes moved to the As built of A21 and A34; the removed one-request brain kept below, as history · D40, D42
- 2026-11-23 · Code left from the first brain (review Q1-Q3): `have_doctor` briefed from its own `approach` - a line in `speak.ts` had been briefed while the file's went unread, and the three other briefs in code could never be reached; `upToQuestion` (`sentences.ts`) and `hasTone` (`tone.ts`) removed, used by tests only; `safety.test.ts` checks every line said by code instead of the old brain's lines; the week and the clock one copy - `WEEKDAYS`, `weekdayOfIndex`, `indexOfWeekday`, `formatClock` in `core/auto-dial.ts`, `dateAfter` in `callback-time.ts` (the days had been listed five times in two orders). Nothing she says changed · `docs/REVIEW-2026-11-22.md`
- 2026-11-23 · The docs read again (review R1-R9): the record is not "never a word said"; `understood` is `early` too; who is there is read before understand, not beside it as designed; the brain says `quiet` for a silence it chose, so `ai_relay.empty_reply` warns only of a reply that should have had words · `docs/REVIEW-2026-11-22.md`
- 2026-11-22 · What the record counts as said (review M1-M8): nothing heard of a reply all sent - its first sentence counts only if it went out two seconds or more before; a sentence replaced by the specialist line - the line's question counted, not the moves decided (a "yes" to "Would you like me to connect you?" had got "anything else?"); who is there on a refused action's retry read from the lead's last turn, not as nobody; the time said back talked over before the time - asked but unheard; "I'm busy" at the greeting - a call back, not the opening; the lead hanging up mid-reply - its sentences kept; "USD", "euros", `€` and `£` prices; resuming past "One moment...", "are you still there?" and a reply nothing of which was heard. The replay's two-no rule changed after it failed every run of call 140, which A34 heard as right. None heard on a real phone; the replays of A34's 25 calls, three times each, 75 of 75 · `docs/REVIEW-2026-11-22.md`
- 2026-11-22 · A reply stopped stops everything after it (review H5): the lead hanging up, or saying more, while understanding started early still ran had left the brain deciding, keeping a record and - for an opt-out - carrying the action out on a call already closed · `docs/REVIEW-2026-11-22.md`
- 2026-11-22 · A confused lead (A34's calls 136 and 137): "heard anyway"; a no with a question not a clear no; `repeat` and `say_again`; `which_next` for several questions at once; "everyone is busy" said once · A34
- 2026-11-21 · Her open question come back to once every three replies, and the offer not brought up otherwise (call 135, the offer in five of seven replies); after a health answer the person or call back offered first (call 130); nothing offered or thanked after an approved answer (call 129); the link for "I want to look myself", a no to "what time?" a no, the name once after the greeting (call 127) · A34
- 2026-11-19 · The one-request brain, kept beside the new one for a rollback since A30, removed at Jeel's word after calls 113-122: `openAiModel` - her whole instructions and the five actions as tools in one streamed request; the actions as OpenAI tools (`ACTION_TOOLS`) and an action written in brackets taken all the same (`writtenAction`, `ai_relay.written_action`); `buildInstructions` and its snapshot; the notes after the lead's turns - `NO_REPEAT_NOTE`, `NO_REPEAT_NOBODY_NOTE`, `NOBODY_NOTE`, `openQuestionNote` (`leadTurn`); the instructions as the call's first message; the relay's `model` dependency; `PROMPT_CACHE_KEY`; the answer test set (`npm run ai:eval` - its runner, cases and grader in `evals/`) and the bake-off (`npm run ai:bakeoff`). `npm run e2e` moved to the new brain. Kept because the new brain goes through them: the stop check, every sentence checked, the limits, the voicemail verdict, `toHandoff` as a guard, the wrap-up note as a marker, the note of who is there, `callPart` · A34
- 2026-11-18 · Her introduction saved (`OPENING_LINE`): after a bare "Yes." she had waited 1.1-2.0 s for speak to write much the same line on every call (calls 118, 119); said 12-16 ms after the words from call 120 · A34
- 2026-11-18 · Speak reads what code said of a reply as her own words: before, after the approved answer she answered the question again her own way - "I can't give exact prices" (call 119), "I can't share those here" (call 120), "we ship nationwide, including Texas" (calls 118, 119) · A29, A34
- 2026-11-18 · A day said alone asked for a time only if it has one (call 122: "Sunday" asked "what time on Sunday?", then refused once a time came) · A34
- 2026-11-18 · `eotThreshold` 0.6 kept after call 119; the head start measured on call 118 - it works but gains little · A33
- 2026-11-17 · A reply heard mostly counts whole, and the opening once any of it was heard: cut off at "Is that something you'd", it had counted as never said and was said three times (call 114) · A34
- 2026-11-17 · Built and measured, each on its own first: decide (A27); understand, 94.5% on the labelled lines (A28); speak, 97.6% over 21 kinds of reply, and "I can't provide that" made a safety-check replacement (`cant_answer`, A29); the brain on the call behind the same `SeriModel`, the one-request brain kept for a rollback (A30); the record of each reply and resume from it, migration 024 (A31); the real calls replayed, 238 of 240 holding every rule (A32); understanding started early (A33) · A27-A33
- 2026-11-17 · Measured, then decided: two steps, understand `gpt-5.4-mini` and speak `gpt-4.1-mini`; read from Twilio's docs that Smart Turn Detection does not apply with Flux · A24
- 2026-11-17 · Designed after A21's call 112. One OpenAI request had made each reply, from one long prompt - every rule, objection, approved answer and product - and the call so far, working out at once what the lead meant, where the call was, what to do and what to say. On calls 86-112 it went wrong in the same few ways, all from working out where the call was: the opening said again two and a half minutes in (112); an offer to connect in 7 of 9 replies (90); a call back at a time she picked herself (92), and on a Saturday (93); offers after two clear no's (99); "Not right now" taken as asking for a person (103); "Let me connect you" with nobody free (111, 112). Each fix had been a rule or a note with the lead's turn, each moving its failure "less often, not never" - 9 of 12, 11 of 12 - while the notes piled up and began to pull against each other · A24-A34
