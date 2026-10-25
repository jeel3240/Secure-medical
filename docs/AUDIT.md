# Nothing is lost: the activity log and the raw archive

Built 2026-10-01. The company's policy is that data is kept as proof - Jeel's
instruction that day: whatever action happens, all of it should be tracked.

Code: `backend/src/core/activity.ts` (the list of actions), `db/activity.ts`
(the writer), migration `006_activity_log.sql`. Proof:
`scripts/activity-live-check.ts`, 42 checks against a real Postgres.

## What was being lost

Most records were already permanent: every text, every call, every note and
every outcome is a row that nothing edits. Three things were not:

| Was lost | Because |
|---|---|
| **Who held a lead, and when** | Pick up and release overwrite `leads.assigned_to` and `assigned_at`. After a release, nothing said Maya held the lead from 2:00 to 2:40 |
| **A callback's original time** | Rescheduling overwrites `callbacks.scheduled_at`; reopening clears `done_at` |
| **An earlier do-not-call block** | Re-blocking a number reuses its row, replacing when and why it was first blocked and that it was ever released |

And three were never captured at all: who signed in, who changed an agent's
account, and what EZ Texting and Twilio actually sent us - only what we made of
it.

## The activity log

`activity_log`: one row per thing that happened.

| Column | |
|---|---|
| `at` | When |
| `actor_id` | Who did it. Null when the system did - a webhook, Twilio |
| `action` | What, as `area.verb`: `lead.picked_up`, `callback.rescheduled` |
| `lead_id` | The lead it was done to, when there is one |
| `subject_user_id` | The user it was done to: the agent whose claim was released, the account that was deactivated |
| `detail` | What would otherwise be lost, as JSON |

### What is recorded

| Action | When | `detail` keeps |
|---|---|---|
| `lead.picked_up` | An agent picks a lead up. Resuming a lead already held is not a new pick-up and records nothing. Taking an automated call's transfer picks the lead up too, from whoever held it (T15a), and so does taking a call back that rang everyone free (T19) | `tookOverFrom`, when taken from a deactivated agent - or, with `via: 'transfer'` or `via: 'call_back'` and the `callId`, from any agent |
| `lead.released` | The Release button (until 2026-10-08, Back to queue); a superadmin's force-release; an outcome letting go of the lead | `heldSince`, `forced`, `because: 'outcome'` |
| `reply.read` | An unread reply is opened - once, by whoever cleared it | |
| `note.added` | A note is saved | `noteId` - the text stays in `notes`, not copied |
| `outcome.set` | Closed or DNC is saved | `value`, `dispositionId` |
| `callback.booked` | A callback is booked. Actor is who booked it, subject who it is for. No actor when the system booked it for a missed call | `callbackId`, `scheduledAt`, `because: 'missed_call'` |
| `callback.rescheduled` | Its time changes | `from`, `to` |
| `callback.done` | Marked done, finished by an outcome, or - a missed call's callback - by the lead being got back to. Actor is who did that | `scheduledAt`, `because`: `outcome`, `called_back`, `texted_back` or `answered` |
| `callback.reopened` | A done callback is un-done | `wasDoneAt` |
| `sms.sent`, `sms.failed`, `sms.blocked` | An agent's own text. `blocked` leaves no message row, so the log is its only record | `messageId`, `tookOver` |
| `call.started`, `call.ended`, `call.refused` | A call. A refused call leaves no `calls` row, so the log is its only record. An automated call's are the system's (no actor) and say `direction: automated` (T12): refused as `not_found`, `blocked`, `already_called`, `no_script` or `not_test_number`; ended as `failed` with `reason: twilio_refused`, `twilioStatus` and `twilioCode` when Twilio would not place it - `AUTO-CALLS.md`, "How a call is placed" - or `reason: no_webhook` when its placing was never confirmed and no webhook named it within 10 minutes (T20, "Traffic") | `callSid`, `callId`, `outcome`, `durationSec`, `reason` |
| `call.incoming` | A lead rings our number and an agent is rung - the subject is that agent; or, for a lead nobody owns, everyone free (T19) - no subject. From a number we hold no lead for there is no `calls` row, so the log is its only record | `callId`, `callSid`; `ring: 'group'` and `rung`, how many, when everyone free rang; for an unknown number, `phone` and `known: false` |
| `call.taken` | A person accepted a lead's call that rang everyone free - the call is theirs from then, and so is the lead (`lead.picked_up`, `via: 'call_back'`) (T19, `TWILIO.md` "Who rings"). Once per call: the first to accept. Without it, nothing would say who took a call no one was rung for by name | `callId`, `callSid`; `tookOverFrom` when the lead was someone else's |
| `call.missed` | An incoming call nobody answered. The subject is the agent it rang - none when it rang everyone free | `callId`, `callSid`; `direction`, `outcome`, `durationSec` when a ring went unanswered; `because: 'no_agent'` when there was nobody to ring |
| `call.held` | A "yes" nobody could take went on hold, waiting for someone on a call or just off one (T16, T17, `AUTO-CALLS.md` "The hold line") - the system's doing, once per call | `callId` |
| `call.transferred` | A person took an automated call's transfer (T15a, `AUTO-CALLS.md` "The transfer") - once per call, whoever held the lead. Without it, a transfer taken by the lead's own holder, or after the browser's own pick-up reached the server first, would leave no record | `callId`; `tookOverFrom` when the lead was someone else's |
| `call.answered_by` | Twilio's verdict on who picked up a call we placed - an agent's or an automated one. On an automated call it is also what the voicemail message acted on (T18, `AUTO-CALLS.md` "Voicemail"): the takeover itself is the call's `script_result` - `voicemail_left`, or `unanswered` for a fax hung up on - written once | `callId`, `callSid`, `answeredBy`; `outcome` once the call has ended; and `outcomeWas` when the verdict changed an agent's `answered` call to `voicemail` - the row is overwritten, so this is what it said |
| `call.recorded` | A call's recording is ready, and its transcript is put in line | `callId`, `callSid`, `recordingSid`, `durationSec` |
| `call.transcribed`, `call.transcript_failed` | The transcript is in, or given up | `callId`, `transcriptSid` and the number of `lines`; or the `reason` |
| `dnc.blocked` | A number is blocked: by a STOP reply, by an agent's DNC outcome, because a contact arrived from EZ Texting already opted out (2026-10-01 - until then that one left no record), or by a lead saying stop on the automated call (reason `call_opt_out`, by the system - T13; once, however often Twilio repeats the request) | `phone`, `reason`, and `previous` - what the row said before a re-block overwrote it |
| `dnc.released` | A block is lifted, by a START reply - the only thing that releases one on a server; locally also `dev:auto-call -- --unblock`, released as `dev_test` | `phone`, `releaseReason`, `blockReason`, `blockedAt` |
| `auth.signed_in`, `auth.signed_out`, `auth.password_changed` | | |
| `auth.sign_in_failed` | A refused sign-in | The `email` tried and `why`. Never the password |
| `user.created`, `user.updated`, `user.password_reset` | A superadmin changes an agent's account | `changes`: each field as `{ from, to }`. Never a password |
| `calls.availability_changed` | The "Taking calls" switch went on or off (T10, `AUTO-CALLS.md` "Who is free") - by the person, or because they signed in or out; or off by the system because they let a transfer ring out (T15c) - then no actor, the person its subject. Only when it really changed | `on`, and `why`: `by_hand`, `sign_in`, `missed_transfer` (with the `callId`) or `sign_out` |
| `auto_calls.switched_on` | The worker started placing automated calls after they were off, or for the first time - each switch-on starts afresh, so leads that arrived while they were off are never called (T20, `AUTO-CALLS.md` "When a lead is called"). The system's doing - someone set `AUTO_CALLS=on`. It overwrites `settings.auto_calls_since`, so the time it replaced is kept here | `since`, `previousSince` |

The list is `ACTIVITY_ACTIONS` in `core/activity.ts`. A new action is added
there first, so the vocabulary stays in one place.

**Not recorded here, because their own rows already are the record:** the
automated SMS flow (every message is in `messages`, including the first
questions the resend after an outage sends - `POLLER.md` - the text after a
missed call, and the link a lead asked for on the automated call), a lead arriving
(`leads`), a conversation completing or expiring (`conversations`), and each
answer a lead gives (`conversation_answers` - add-only, and tied to the
inbound text it was read from; on an automated call, `call_answers` - add-only
too, with what Twilio heard, since migration 015), and each time a lead on
hold rang someone who came free (`call_offers`, since 020 - who, when, and how
it ended). When automated calls were last switched on (`auto_calls_since` in
`settings`, T20) is overwritten at each switch-on, so each switch-on is
recorded with the time it replaced - `auto_calls.switched_on`. Each robot call
the worker places is its `call.started`, as one placed by hand. A reply that was not counted because it
arrived before our text had gone out is kept in `messages` like any other,
and written to the application log as `reply.before_our_text` (`LOGGING.md`) -
not an activity-log action.

**Not recorded at all:** whether a browser can take a call right now
(`users.ringable_until`, T9). It is the present moment, said by each open
browser every half minute and overwritten each time - not something anyone
did. The "Taking calls" switch, which a person does turn on and off, is
recorded (T10, `calls.availability_changed`, above).

### Written with the action, not after it

A record written separately could say something happened that was rolled back,
or miss something that was not. So:

- **A single statement** where the action is one statement. Picking up a lead
  is one `UPDATE` precisely so two agents cannot both win; its record is a CTE
  in that same statement (`db/claims.ts`), and the race rule is unchanged -
  `scripts/claims-live-check.ts` still passes.
- **The same transaction** where the action is several statements: an outcome
  (`db/dispositions.ts`), an agent's text, starting a call, a lead calling in.
  The end of a call is one statement that writes the call's end, the callback
  a missed call books, and all three records (`db/calls.ts`, `finishCall`).
- **Sign-ins and account changes** go through `deps.activity` in the routes.
  These are written just after the change, not atomically with it - the user
  store is an interface the tests replace.

Each statement records **only what actually changed**: moving a callback to
the time it already has, marking a done callback done again, or releasing a
lead nobody holds writes nothing.

### It cannot be altered

A trigger on `activity_log`, on `webhook_events`, on `conversation_answers`
(since migration 012) and on `call_answers` (since 015) refuses every `UPDATE`
and `DELETE`:

```
activity_log is add-only: rows cannot be changed or deleted
```

A record that can be edited is not proof, so the database refuses whoever
asks - the app, a script, or someone in `psql`.

`call_offers` (020) is written as a ring from hold starts and has its end
written once, when it is over: a trigger refuses any other change, a second
end, and every `DELETE` (`call_offers: only an offer's end can be written`,
`call_offers: an ended offer cannot be changed`, `call_offers: rows cannot be
deleted`).

## The raw webhook archive

`webhook_events`: every request EZ Texting and Twilio send, as it arrived,
stored before anything is decided about it - including the ones we go on to
ignore.

| Column | |
|---|---|
| `received_at` | |
| `source` | `eztexting` or `twilio` |
| `path` | The route, without the secret path segment |
| `payload` | The body, as `JSON` |

**`JSON`, not `JSONB`.** JSONB reorders keys and drops duplicates; this is kept
as proof of what was sent, so it is stored as the text that arrived. The live
check caught the difference.

- **EZ Texting**: archived after the path token is checked and outside the
  handler's transaction, so a request that is ignored or fails is still on
  record. A wrong-token request is not archived - it is not EZ Texting's.
- **Twilio**: archived once the signature is verified. A failure to archive is
  logged (`twilio.archive_failed`) and does not stop the call.

EZ Texting delivers every inbound text on the account to us, including replies
to the client's own campaigns (`EZTEXTING-API.md`). Those are archived too:
they are what was sent to us.

## A lead with history cannot be deleted

Texts, calls, notes, outcomes, callbacks and conversations pointed at their
lead with `ON DELETE CASCADE`: deleting a lead row would have deleted all of it.
Nothing in the app deletes a lead, but the database should refuse rather than
rely on that. Migration 006 removes the cascade; a delete is now refused while
any row still points at the lead.

**Locally, to start over,** delete nothing - empty the tables:

```sql
TRUNCATE leads, dnc_list, webhook_events RESTART IDENTITY CASCADE;
```

`TRUNCATE` is not stopped by the add-only triggers, which is what makes a local
reset possible. It needs the table owner's rights. Never run it on production.

## On the screen

The Lead Timeline shows the log's entries that have no row of their own,
labelled `LOG`:

- "Picked up the lead"
- "Put the lead back in the queue · held 40 min" / "Lead released - outcome
  saved · held 12 min" / "Released the lead from Maya Chen · held 2 h 5 min"
- "Callback moved from Thu, Oct 1 9:38 AM to Sat, Oct 3 8:38 AM"
- "Callback reopened - it had been marked done"
- "Text not sent - the number is on the do-not-call list"
- "Call not placed - the lead was not picked up"

Notes, outcomes, calls and booked callbacks are already on the timeline from
their own tables and are not repeated. That includes an incoming or missed
call, and the callback the system books for one ("Callback added · missed
call", then "Missed call returned") - `call.incoming`, `call.missed` and
`callback.done` are in the log, not shown as `LOG` entries. The workspace conversation does not show
`LOG` entries: it stays the text thread.

Everything else in the log - sign-ins, account changes, DNC history - is in the
database and has no screen yet.

## What this does not cover

- **Call audio.** Recorded when the transcription service is set, but the
  audio stays at Twilio: we keep its id and the transcript (`call_recordings`,
  `call_transcripts`). The lead hears a recording notice first - `TWILIO.md`.
- **Backups.** The log protects against the app and against edits. It does not
  protect against losing the database. That is RDS: automatic backups with
  enough retention, deletion protection on the instance, and optionally a daily
  dump to S3 (CLAUDE.md §2). These are AWS settings, checked by Jeel.
- **The table owner.** Someone with the owner's rights can `TRUNCATE` a table
  or drop the trigger. Production's database user should be the only holder of
  those rights, and nobody should use it by hand - `WORKFLOW.md`, "Migrations".
- **Application logs.** `LOGGING.md`'s JSON logs go to CloudWatch, with their
  own retention. They are for operations; the activity log is the record.
- **A screen for the whole log.** Admin can see a lead's entries on its
  timeline. Sign-ins and account changes are queried in the database.
- **Reading.** Who opened which lead is not recorded, only who acted on it.

## Testing

| What | Where |
|---|---|
| Every action leaves its record, the poller's block of an opted-out arrival included; nothing is recorded when nothing changed; the log and the archive refuse edits and deletes; a lead with history cannot be deleted | `scripts/activity-live-check.ts` |
| Calls: `call.incoming`, `call.missed`, the callback the system books and what finishes it (`called_back`, `answered`) | `scripts/calls-live-check.ts` |
| `callback.done` with `texted_back` | `scripts/agent-sms-live-check.ts` |
| The claim race still holds with the record in the statement | `scripts/claims-live-check.ts` |
| Sign-ins, failures and account changes, and that no password is ever recorded | `src/api/__tests__/activity.test.ts` |
| The archive: kept for an ignored request, not kept for a wrong token | `src/api/__tests__/webhooks.test.ts`, `calls.test.ts` |
| The timeline shows log entries once, not twice | `scripts/timeline-live-check.ts` |
| The wording on screen | `frontend/src/components/Timeline.test.tsx` |

## Reading the log

```sql
-- Everything that happened to a lead, in order.
SELECT a.at, u.name AS who, a.action, a.detail
FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id
WHERE a.lead_id = 42 ORDER BY a.id;

-- Who held a lead, and for how long.
SELECT s.name AS agent, (a.detail->>'heldSince')::timestamptz AS from_time, a.at AS to_time
FROM activity_log a JOIN users s ON s.id = a.subject_user_id
WHERE a.lead_id = 42 AND a.action = 'lead.released' ORDER BY a.id;

-- Every text EZ Texting sent us from one number, as received.
SELECT received_at, payload FROM webhook_events
WHERE source = 'eztexting' AND payload->>'fromNumber' = '16026203572' ORDER BY id;
```
