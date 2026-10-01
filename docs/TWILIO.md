# Browser calling (Twilio)

Phase 4, built 2026-10-01. An agent clicks **Call** in the workspace and talks
to the lead from the browser. The lead sees Secure Medical's number. Every call
is saved to `calls` and shows on the lead's timeline.

Code: `backend/src/core/calls.ts` (the rules, pure), `db/calls.ts` (the SQL),
`integrations/twilio.ts` (the only file that uses the twilio library),
`api/calls.ts` (the browser's routes), `api/twilio-webhooks.ts` (Twilio's
routes), `twilio-settings.ts` (the settings). Screen: `frontend/src/lib/call-state.ts`,
`lib/calling.ts`, `pages/workspace/useLeadCall.ts`, `pages/workspace/CallControl.tsx`.

## How a call works

```
Agent's browser                 Our API                         Twilio                Lead's phone
     │  POST /api/calls/token      │                               │                       │
     │ ───────────────────────────►│  signs a 1-hour token         │                       │
     │ ◄─────────────────────────── │                               │                       │
     │  connect, with { leadId }   │                               │                       │
     │ ────────────────────────────────────────────────────────────►│                       │
     │                             │  POST /api/webhooks/twilio/voice  (signed)            │
     │                             │ ◄──────────────────────────────│                       │
     │                             │  agent holds the lead? number not on DNC?             │
     │                             │  records the call; answers "dial this number"         │
     │                             │ ──────────────────────────────►│  rings ──────────────►│
     │ ◄═══════════ audio: browser ↔ Twilio ↔ phone, never through our server ════════════►│
     │                             │  POST /api/webhooks/twilio/status  (signed)           │
     │                             │ ◄──────────────────────────────│  the call ended       │
     │                             │  saves outcome and talk time   │                       │
```

1. **Token.** `POST /api/calls/token`, signed-in users only. A JWT signed with
   the Twilio API key, valid one hour, for the identity `agent-<user id>`. It
   allows outgoing calls through our TwiML App and nothing else - no incoming
   grant, because nothing in the app answers a call. The browser refreshes it
   before it lapses.
2. **The browser calls** with Twilio's Voice SDK, sending only the lead's id.
   It never sends a phone number: the server looks the number up.
3. **Twilio asks how to connect** - `POST /api/webhooks/twilio/voice`. The
   server checks the request is Twilio's (below), then, in one transaction
   (`db/calls.ts`, `startCall`):
   - the agent is active and **holds the lead** - the same rule as every other
     write on a lead, `AGENT-WORKSPACE.md`, "Rules";
   - the number is **not on the do-not-call list** - a DNC blocks calls as
     well as texts;
   - then it inserts the `calls` row and answers with TwiML that dials the
     lead, with `TWILIO_PHONE_NUMBER` as caller ID.

   If a check fails, nothing is recorded and the agent hears one sentence
   saying why, then the call ends. The screen stops all of these before the
   click; the server checks again because the screen is a courtesy, not the
   lock.
4. **Twilio reports the end** - `POST /api/webhooks/twilio/status`, on the
   lead's leg of the call, whoever hung up. `finishCall` saves the outcome,
   the talk time and `ended_at`.

Audio goes browser ↔ Twilio ↔ phone. It never passes through our server
(CLAUDE.md §2), so the server's size has no bearing on call quality.

## What is saved

One row in `calls` per call. No migration was needed - the table has been in
`001_init.sql` since Week 1.

| Column | Value |
|---|---|
| `twilio_call_sid` | Twilio's id for the **browser's** leg. Unique, which is what makes a retried webhook safe |
| `agent_id`, `lead_id` | Who called whom |
| `started_at` | When Twilio asked us how to connect it |
| `ended_at` | When Twilio reported the lead's leg ended. Null while the call is in progress |
| `outcome` | `answered`, `no_answer`, `busy`, `failed` or `canceled` - `core/calls.ts`. Null while in progress |
| `duration_sec` | Seconds of conversation. 0 unless answered |

| Twilio says | We record |
|---|---|
| `completed` | `answered` |
| `no-answer` | `no_answer` |
| `busy` | `busy` |
| `failed` | `failed` |
| `canceled` | `canceled` - the agent hung up while it was ringing |

**Both writes are idempotent.** Twilio retries a webhook that is slow to
answer. A repeated voice request carries the same CallSid: the insert does
nothing and the call is connected again. A repeated or late status report
finds `ended_at` already set and changes nothing - the first outcome stands.

**A call makes its lead Working** on Admin > Leads, and counts as the agent's
latest activity on Overview. Both already read `calls` (`db/lead-state.ts`,
`db/admin-overview.ts`); nothing was added for it. Overview shows no call
totals - they were removed on 2026-09-28 at Jeel's request and are not back.

## Why the webhooks can be trusted

They are unauthenticated - Twilio has no session - but Twilio signs every
request: `X-Twilio-Signature` is an HMAC of the exact URL it requested plus the
posted fields, keyed with our auth token. `isFromTwilio` checks it; anything
unsigned or mis-signed gets 403 before the database is touched.

**The URL is rebuilt from `PUBLIC_URL`, not from the request.** Behind Caddy or
a tunnel, Express sees a different scheme and sometimes a different host than
Twilio called, and a signature checked against the wrong URL fails every time.
So `PUBLIC_URL` must be exactly the address Twilio uses. A wrong one shows up
as `twilio.webhook_rejected` in the logs and calls that end at once.

**The agent's identity is ours.** `From: client:agent-21` comes from the token
we signed, inside a request Twilio signed, so the agent id in it can be
trusted without a session.

With calling not set up, both webhook routes answer 404.

## Settings

Seven variables. `.env.example` says where each comes from in the Twilio
Console.

| Variable | What |
|---|---|
| `TWILIO_ACCOUNT_SID` | The account, `AC…` |
| `TWILIO_AUTH_TOKEN` | Verifies webhook signatures; used by `twilio:configure` |
| `TWILIO_API_KEY`, `TWILIO_API_SECRET` | A **Standard** API key, `SK…`, and its secret. They sign the browser's token |
| `TWILIO_TWIML_APP_SID` | The TwiML App, `AP…`, whose Voice URL is our voice webhook |
| `TWILIO_PHONE_NUMBER` | The caller ID, E.164. Must be a number on the same account |
| `PUBLIC_URL` | This app's public https address, no trailing slash |

`twilio-settings.ts` reads them into one of three states:

| State | When | Effect |
|---|---|---|
| **off** | No `TWILIO_*` variable is set | The app runs as before. The Call button is off: "Calling is not set up on this server." |
| **on** | All seven are set and well-formed | Calling works |
| **incomplete** | Some are set, or one is malformed | Locally: calling is off and the API logs `calling.off` naming what is missing. **In production the API refuses to start** (`twilio_incomplete`), because a half-set configuration looks fine and fails every call |

**Point the TwiML App at the server** once `PUBLIC_URL` is set, and again
whenever it changes:

```bash
docker compose exec api npm run dev:twilio:configure   # local
docker compose exec api npm run twilio:configure       # production
```

It sets the TwiML App's Voice URL to `PUBLIC_URL/api/webhooks/twilio/voice`
and changes nothing else on the account.

## The screen

**A Call button, then a call bar** - Jeel's design, 2026-10-01. The lead
header has only the button (`CallControl.tsx`). Pressing it slides a dark bar
up from the foot of the screen (`CallBar.tsx`), which stays in view while the
agent scrolls the conversation or types in Wrap up. The first version turned
the header itself into the call's controls, which scrolled out of sight.

```
[PS] Priya S. (555) 010-0016        0:42   | Mute  Keypad |  End
     Connected
```

| State | The bar shows |
|---|---|
| Connecting | "Connecting…", the clock at 0:00, **End**. Mute and Keypad are off - there is nobody to mute yet |
| Ringing | "Ringing…". The agent hears real ringback |
| Live | "Connected", a running clock, **Mute**, **Keypad**, **End**. The dot on the avatar turns green |
| Ended | It becomes a **note box**: "Call ended · 2:14" (or "No answer", "Call cancelled"), a field already focused, **Save note** and **Skip** |
| Failed | A sentence the agent can act on - microphone blocked, no microphone, the call did not connect - and **Dismiss** |

**An invalid number reads "The call did not connect. The number may not be
reachable, or the connection dropped."** Twilio gives the browser one code,
31005, for both, so the sentence covers both; it said "check your internet"
until a call to a test lead's made-up 555 number showed that was the wrong
advice. The call is still recorded, as `failed`.

**The note after a call** is asked at the moment the agent knows the answer.
It is saved straight to the lead's notes - the same note Wrap up writes - so
it appears in the Notes card at once and is recorded in the activity log.
Enter saves; Skip is always there, because not every call needs a note. The
bar stays until one of them is pressed: it does not time out while someone is
typing.

**Keypad** sends tones for a phone menu or an extension, and shows what was
pressed, since a tone cannot be seen.

**The Call button is off, with the reason as a tooltip,** when the number is on
the do-not-call list, calling is not set up, or the viewer has not picked the
lead up. While a call is in progress it reads "On call".

**Leaving the lead ends the call.** `useLeadCall` hangs up when the page is
left; closing the tab mid-call asks first. The page owns the call
(`WorkspacePage.tsx`) because the button and the bar both use it.

**A call shows in the workspace** as a quiet line in the conversation -
"Outbound call · answered · 2:14 · Maya Chen · 3:02 PM" - and on the Lead
Timeline. Only an answered call shows a length.

**Twilio's SDK loads on the first call,** as its own file (about 47 KB
gzipped), not with the app.

The states are a pure reducer, `lib/call-state.ts`, tested without a
microphone. `lib/calling.ts` is the only file that touches the SDK.
`CallBar.test.tsx` covers the bar in every state.

## Testing

| What | Where |
|---|---|
| Settings: off, on, incomplete, malformed values | `src/twilio-settings.test.ts` |
| Identity, outcomes, talk time | `src/core/calls.test.ts` |
| The token's claims, the TwiML, the signature check | `src/integrations/twilio.test.ts` |
| The four routes, refusals, a database failure | `src/api/__tests__/calls.test.ts` |
| The SQL: who may call, DNC, retries, the timeline | `scripts/calls-live-check.ts` - 18 checks against a real Postgres |
| Call states, wording, error sentences | `frontend/src/lib/call-state.test.ts`, `lib/calling.test.ts` |

**Locally a real call needs a public address**, because Twilio must reach the
voice webhook:

```bash
cloudflared tunnel --url http://localhost:3000     # prints an https address
# put it in .env as PUBLIC_URL, then:
docker compose up -d api
docker compose exec api npm run dev:twilio:configure
```

A quick tunnel's address changes every time it starts, so repeat the last
three lines each time. Verified this way on 2026-10-01: a request signed the
way Twilio signs, sent through the tunnel, was refused unsigned (403),
connected for the agent holding the lead, refused for another agent, and its
end-of-call report saved as answered, 42 seconds.

**A real call, 2026-10-01:** Jeel picked up a lead that was his own phone and
pressed Call. The phone rang showing the client's number, was answered, and the
call was saved as `answered`, 15 seconds, with its start and end times.

**Every call on a paid account is a real call that costs money.** Test to your
own phone.

## Deploying it

1. Set the seven variables in the server's `.env`. `PUBLIC_URL=https://dailyleadhub.com`.
2. Deploy as usual (`WORKFLOW.md`, "Deploying"). No migration.
3. `docker compose exec api npm run twilio:configure`.
4. Sign in, pick up a lead that is your own phone, press Call.

## What is kept as proof

- **Every signed request from Twilio** is stored as it arrived in
  `webhook_events`, before the handler runs.
- **`call.started`, `call.ended` and `call.refused`** go to the activity log. A
  refused call has no `calls` row, so the log is its only record.

`AUDIT.md` has the whole picture.

## Not built

- **Hold.** The call bar's design has a Hold button; it is not on the screen. A
  real hold - the lead hears music and is brought back - needs the call set up
  as a conference on the server, which Phase 4 did not build, and a button
  that only muted would mislead.
- **Recording, voicemail drop, transfer.** Not in the plan. Recording needs the
  lead's consent, and is waiting on Jeel's decision.
- **Incoming calls.** A lead who rings the number back reaches whatever the
  number is configured to do in Twilio, not the app.
- **A stale call is not closed.** If Twilio's end-of-call report never arrives,
  the row keeps `ended_at` null and the timeline says "in progress". Not seen
  in testing; Twilio retries its callbacks.
- **Call totals on Admin > Overview.** Removed 2026-09-28, deliberately.
