# Lead flow

A lead's whole life on one page: every status it passes through, what moves it
on, and where agents see it. Decided by Jeel, 2026-09-28.

This is the map, not the rules. Each step links to the doc that owns it, and
that doc wins if the two ever disagree:

| Part | Owned by |
|---|---|
| The SMS questions, replies, scoring, expiry, STOP | `STATE-MACHINE.md` |
| The statuses and exactly how each is worked out | `ADMIN-LEADS.md`, "Status is derived, never stored" |
| Who is in the queue, the order, the STATUS column | `QUEUE.md` |
| Picking, Wrap up, Closed and DNC | `AGENT-WORKSPACE.md` |

## The main path

```
  New lead arrives from EZ Texting
            │
            ▼
   ┌─────────────────┐
   │ AWAITING REPLY  │  Question 1 sent, no usable answer yet
   └────────┬────────┘
            │ answers Q1
            ▼
   ┌─────────────────┐
   │   ANSWERING     │  Answered Q1, or Q1 and Q2
   └────────┬────────┘
            │ answers Q3
            ▼
   ┌─────────────────┐
   │     READY       │  All three answered, no agent has touched it   ◄ in the queue
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
            └── texts STOP ──────────────► OPTED OUT      never contacted again
```

An agent's DNC button leads to Opted out too, from any status.

## Every status

These are the tabs on Admin > Leads. When more than one could apply, the
highest in this list wins.

| Status | Means | In the queue? |
|---|---|---|
| **Opted out** | Texted STOP, or an agent pressed DNC. The number is blocked | No |
| **Closed** | An agent pressed Closed | No |
| **Working** | An agent holds it, or has left a note, callback, call, SMS or outcome on it | Yes |
| **Needs review** | Two replies we could not understand | Yes |
| **Ready** | Answered all three, nobody has touched it | Yes |
| **Expired** | Went quiet during the questions | No, unless they text us |
| **Answering** | Partway through the questions | No |
| **Awaiting reply** | Has not answered question 1 | No |

Working outranks the SMS statuses: an expired or needs-review lead that an
agent is handling reads Working.

## What agents see in the queue

The queue's STATUS column shows at most one of five things, in this order when
more than one applies. Most rows show none.

| STATUS | Means |
|---|---|
| **Working – karm** | karm is holding the lead right now. Others see it locked |
| **Missed call** | The lead rang our number and nobody answered. They were told, and texted, that we will call back |
| **Inbound reply** | The lead texted us and nobody has read it |
| **Callback – karm · 3:00 PM** | karm has a callback booked on it. Not locked, but it is karm's call to make |
| **Needs review** | We could not understand their replies |
| **-** | Waiting for someone to pick it up |

A lead someone holds is always in the queue, even one picked up from Admin >
Leads before it answered anything.

"Working – karm" lasts only while karm holds the lead. Admin > Leads keeps
saying Working after karm lets go, until the lead is Closed.

## Working a lead

1. **Pick up** from the queue. Opening a row only looks; Pick up is what
   assigns the lead.
2. In **Wrap up**:
   - **1 Outcome** - **Closed** or **DNC**, or neither
   - **2 Callback** - optional
   - **3 Note** - "no answer", "left a voicemail", "call back Friday"
3. **Save**.
   - With **Closed** or **DNC**: the lead is released and leaves the queue at
     once, any open callback on it is marked done, and the agent is taken back
     to the queue. Nobody needs to pick it up any more - Jeel, 2026-09-29.
     While Closed or DNC is chosen, the callback choices are switched off.
   - With only a callback or a note: the agent stays on the lead.
4. **Back to queue** releases a lead the agent is leaving without an outcome.

There is no reason to pick when closing. The note says why, if anything does.

## Ways back into the queue

| What happens | Result |
|---|---|
| An expired lead texts us | Back as **Inbound reply** |
| A closed lead texts us | Back as **Inbound reply**. Once read, it is Closed again |
| A lead calls our number and nobody answers | Back as **Missed call**, closed or not, until an agent calls or texts them. `TWILIO.md`, "Incoming calls" |
| An agent books a callback after closing a lead | Back as **Working**, until the callback is done |
| An opted-out lead texts START | Unblocked, and back as **Inbound reply** for a person to read. The questions do not restart - `STATE-MACHINE.md`, "Opting back in" |
| An agent picks a lead and puts it back without doing anything | Back to **Ready** |

## What changed on 2026-09-28

The flow above replaced a looser one the same day:

| Before | After |
|---|---|
| Every responder in the queue, including leads halfway through | Only leads that need a person |
| Six queue tags: New, Attempted 2x, Callback, In progress, Inbound reply, Needs review | Three: Working – name, Inbound reply, Needs review |
| Admin > Leads statuses described the SMS only; "Completed" forever | Ready, Working and Closed follow the agent part too |
| "In progress" meant two things | Answering (SMS) and Working (agent) |
| Eight outcomes, none of which removed a lead | Closed and DNC. Closed removes it |
| Save and Save & next lead | Save. An outcome releases the lead and returns to the queue (2026-09-29) |

## What changed on 2026-09-29

Found by testing the whole flow with a real phone:

| Before | After |
|---|---|
| A closed lead stayed in the queue as "Working – Maya" until she pressed Back to queue | Saving Closed or DNC releases it: out of the queue at once |
| A closed lead that texted and was picked up again read Closed, and Closed could not be saved again | A lead someone holds is never closed; the holder's Closed always saves |
| A lead picked up before it answered was missing from the queue | Holding a lead always keeps it in the queue |
| A callback showed nothing in the queue | "Callback – Maya Chen · 8:13 PM" |
| Closing left the lead's callback open on My Callbacks | Closing marks it done |
| Admin > Leads Step: the last question answered, one behind | The question the lead is on now, or Done |
| Questions checked every 60 seconds | Every 30 seconds (migration 005) |
