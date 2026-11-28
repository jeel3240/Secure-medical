# Lead flow

A lead's whole life on one page - start here. This is the map, not the rules: every
line links to the doc that owns it, and that doc wins if the two ever disagree.
How the parts of the system carry a lead along is `ARCHITECTURE.md`, "How they
connect".

| Part | Owned by |
|---|---|
| The SMS questions, replies, scoring, expiry, STOP | `STATE-MACHINE.md` |
| How the questions are stored - the antibiotics flow and adding another | `FLOWS.md` |
| The statuses and exactly how each is worked out | `ADMIN-LEADS.md`, "Status" |
| Who is in the queue, the order, the tag | `QUEUE.md` |
| Picking up, Wrap up, Closed and DNC | `AGENT-WORKSPACE.md` |
| Callbacks, and My Callbacks | `CALLBACKS.md` |
| The robot's call: who it rings, when, and what each answer does | `AUTO-CALLS.md`, `AUTO-CALL-SCRIPT.md`, `AUTO-CALL-TRANSFER.md` |
| Seri, the AI agent who runs that call when switched on | `AI-AGENT.md` |
| Calls with a person: placed by an agent, and a lead calling in | `TWILIO.md`, `INCOMING-CALLS.md` |

## The main path

```
  New lead arrives from EZ Texting
            │
            ▼
   ┌─────────────────┐
   │ AWAITING REPLY  │  Question 1 sent, no usable answer yet
   └────────┬────────┘
            │ answers the first question
            ▼
   ┌─────────────────┐
   │   ANSWERING     │  Partway through the questions
   └────────┬────────┘
            │ answers the last one
            ▼
   ┌─────────────────┐
   │     READY       │  Questions finished, no agent has touched it   ◄ in the queue
   └────────┬────────┘
            │ an agent picks it up
            ▼
   ┌─────────────────┐
   │    WORKING      │  An agent is on it, or has been                ◄ in the queue
   └────────┬────────┘
            │ the agent presses Closed and saves
            ▼
   ┌─────────────────┐
   │     CLOSED      │  Finished                                      ◄ out of the queue
   └─────────────────┘
```

## The other ways the SMS part ends

```
   AWAITING REPLY or ANSWERING
            │
            ├── two unclear replies ─────► NEEDS REVIEW   in the queue: a person reads them
            │
            ├── silent for 7 days ───────► EXPIRED        out of the queue
            │
            ├── texts STOP ──────────────► OPTED OUT      never contacted again
            │
            ├── says No, then asks ──────► OFFERS         out of the queue: a list for
            │   for special offers only                   the client's campaigns
            │
            └── says No, then ───────────► NOT INTERESTED out of the queue: wants
                No thanks                                 neither offers nor a rep
```

The questions are the eDrugstore antibiotics flow; a lead who says No to the
first is asked one other thing - `FLOWS.md`, "The antibiotics flow". An agent's DNC
leads to Opted out too, from any status.

## Every status

The tabs on Admin > Leads. When more than one could apply, the highest in the
list wins (`ADMIN-LEADS.md`, "Rules").

| Status | In one line | Owned by |
|---|---|---|
| **Opted out** | The number is blocked - STOP, an agent's DNC, a stop said on the robot's call, or blocked when the lead arrived | `ADMIN-LEADS.md`, "Status"; `AGENT-WORKSPACE.md`, "Blocking a number" |
| **Closed** | An agent pressed Closed, and nothing has reopened it | `ADMIN-LEADS.md`, "Closed" |
| **Working** | An agent holds it, or has left a trace on it | `ADMIN-LEADS.md`, "Working" |
| **Needs review** | Two replies we could not understand | `STATE-MACHINE.md`, rule 4 |
| **Ready** | Finished the questions, or asked to hear from a rep; nobody has touched it | `ADMIN-LEADS.md`, "Status" |
| **Offers** | Said No, then asked for special offers only | `FLOWS.md`, "What a choice's ending means" |
| **Not interested** | Said No, then No thanks to the offers and to a rep | `FLOWS.md`, "What a choice's ending means" |
| **Expired** | Went quiet during the questions | `STATE-MACHINE.md`, "Expiry" |
| **Answering** | Partway through the questions | `ADMIN-LEADS.md`, "Status" |
| **Awaiting reply** | Has not answered question 1 | `ADMIN-LEADS.md`, "Status" |

Which of them are in the queue, and what brings the others in, is `QUEUE.md`, "Who
is in it".

**The robot's call is a second track** beside the status: Admin > Leads' Call
column says how it went, so a lead can be Awaiting reply and "Voicemail left" at
once (`ADMIN-LEADS.md`, "Call"). Once a lead has answered that call, or rung us,
the text questions stop (`STATE-MACHINE.md`, rule 2d).

**Seri**, with her switch on, takes an answered robot call and ends it one of five
ways - a person now, a call back at a time the lead picks, the link, an opt-out or
a goodbye (`AI-AGENT.md`). A call back she books puts the lead first in the queue
once due (`CALLBACKS.md`, "Seri's call backs").

## What agents see in the queue

The queue's STATUS column shows at most one tag - Working – name, Missed call,
Wants a call, Callback · time, Inbound reply or Needs review - and most rows show
none. Which wins, and the order of the rows, is `QUEUE.md`, "The tag" and "The
order".

## Working a lead

1. **Pick up** from the queue - opening a row only looks (`AGENT-WORKSPACE.md`,
   "Claim and release").
2. In **Wrap up**: an outcome, **Closed** or **DNC**, or neither; a callback; a
   note. Closed asks why - Sold, Not interested or Wrong number (`AGENT-WORKSPACE.md`,
   "Dispositions").
3. **Save.** With Closed or DNC the lead is released and leaves the queue
   (`AGENT-WORKSPACE.md`, "Closing a lead"). **Release** lets a lead go without an
   outcome.

## Ways back into the queue

| What happens | Owned by |
|---|---|
| An expired or closed lead texts us | `QUEUE.md`, "Who is in it"; `ADMIN-LEADS.md`, "Closed" |
| A lead calls our number and nobody answers | `INCOMING-CALLS.md`, "A missed call"; `CALLBACKS.md`, "A missed call's callback" |
| An agent books a callback after closing a lead | `ADMIN-LEADS.md`, "Closed" |
| An opted-out lead texts START | `STATE-MACHINE.md`, "Opting back in" |
| An agent picks a lead up and releases it without doing anything | `AGENT-WORKSPACE.md`, "Claim and release" |

## History

- 2026-11-28 · Closed asks why · Closed stood for sold, not interested and wrong number alike; Admin counts sales by it, and a new bucket will tell a sale from a wrong number · B04
- 2026-11-27 · Rewritten as the map: one linked line per status, tag and step, nothing restated; the four "What changed" sections moved here in date order; "built, not yet deployed" for Seri corrected - she has been on production since 2026-11-24, her switch off · D25
- 2026-11-24 · Seri's switch on Admin > Configuration's Calls tab, as well as `npm run ai-agent -- on|off` · A22
- 2026-11-13 · Seri described here: off by default, her switch `settings.ai_agent` seeded `off` and off whatever it says while `OPENAI_API_KEY` is empty; on, an answered robot call goes to her instead of the script's first question; anything the lead says to her stops the text questions; her call back belongs to the lead's holder when an active agent holds the lead, otherwise to nobody, does not make the lead Working, and once due puts the lead first as **Callback · 3:00 PM**, bold, taken by the first agent to pick the lead up; Admin > Leads' Call column reads "Callback booked", and her conversation is on the timeline under the call · A13-A19
- 2026-10-27 · Once a lead has answered the robot's call - yes, no, the link - or rung us, the text questions stop: anything they text goes to a person as Inbound reply, never an automated "sorry" · rule 2d
- 2026-10-25 · The robot's call as a second track: Admin > Leads' Call column; a "yes" nobody took is in the queue as **Wants a call**, first, the longest waiting on top · T22, T23
- 2026-10-05 · The flows. One script, health and wellness - interest, timing, how to contact - became the eDrugstore antibiotics script, with a second path for a lead who says No. Three questions for everyone, answers in three columns, became a flow of rows, as many questions as it needs. The queue's Interest, Timing and Preference columns became one **Answers** column. Everyone who finished had been Ready; offers-only leads became **Offers**, out of the queue, and a lead who asked for a rep Ready, tagged **Wants a call**. A reply and the next question, two texts, became one · Phase 5
- 2026-10-01 · Calling, both ways. The Call button had been a placeholder: agents call a lead they hold from the browser, every call on the timeline. A lead who rang our number had reached nothing: they ring the browser of the agent holding them, or who last called them. A call nobody answers: the lead hears a message and is texted, the queue says **Missed call**, and the agent it rang gets a callback - none when it rang everyone free (T19), and the lead waits in the queue for anyone. Four queue statuses became five, Missed call second after Working. A callback had only ever been booked by a person: the system books one for a missed call, and finishes it when the lead is got back to · Phase 4
- 2026-09-29 · Found by testing the whole flow with a real phone. A closed lead stayed in the queue as "Working – Maya" until she pressed Back to queue: saving Closed or DNC now releases it, out of the queue at once. A closed lead that texted and was picked up again read Closed, and Closed could not be saved again: a lead someone holds is never closed, and the holder's Closed always saves. A lead picked up before it answered was missing from the queue: holding a lead always keeps it in. A callback showed nothing in the queue: "Callback – Maya Chen · 8:13 PM". Closing left the lead's callback open on My Callbacks: closing marks it done. Admin > Leads' Step showed the last question answered, one behind: the question the lead is on now, or Done. Questions checked every 60 seconds: every 30 (migration 005) · Jeel
- 2026-09-28 · Written, decided by Jeel: the flow above replaced a looser one the same day. Every responder had been in the queue, leads halfway through included: only leads that need a person. Six queue tags - New, Attempted 2x, Callback, In progress, Inbound reply, Needs review - became three: Working – name, Inbound reply, Needs review. Admin > Leads' statuses had described the SMS only, "Completed" for ever: Ready, Working and Closed follow the agent part too. "In progress" had meant two things: Answering (SMS) and Working (agent). Eight outcomes, none of which removed a lead, became Closed and DNC, and Closed removes it. Save and Save & next lead became Save; an outcome releases the lead and returns to the queue (2026-09-29) · Jeel
