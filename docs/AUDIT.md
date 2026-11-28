# Nothing is lost: the activity log and the raw archive

The company keeps data as proof, so every action a person or the system takes is
one row in `activity_log`, and every request EZ Texting and Twilio send is kept as
it arrived in `webhook_events`. Two rules hold for both: **a record is written with
its action** - in the same statement or transaction, so neither exists without the
other - and **a record cannot be altered**: the database refuses every change and
delete, whoever asks. The list of actions is `ACTIVITY_ACTIONS` in
`backend/src/core/activity.ts`, the writer `backend/src/db/activity.ts`; the
tables' columns are in `SCHEMA.md`.

## The actions

Each row names who did it (`actor_id`, none when the system did - a webhook,
Twilio, the worker), what (`action`, `area.verb`), the lead and the user it was
done to, and in `detail` what would otherwise be lost. A statement records **only
what changed**: moving a callback to the time it already has, marking a done
callback done again, or releasing a lead nobody holds writes nothing.

| Action | When | Actor | `detail` keeps |
|---|---|---|---|
| `lead.picked_up` | An agent picks a lead up. Resuming a lead already held records nothing. Taking an automated call's transfer picks the lead up too, from whoever held it, and so does taking a call back that rang everyone free | The agent | `tookOverFrom` when taken from a deactivated agent - or, with `via: 'transfer'` or `via: 'call_back'` and the `callId`, from any agent |
| `lead.released` | The Release button, a superadmin's force-release, or an outcome letting go of the lead | Who released it; subject, the holder | `heldSince`, `forced`, `because: 'outcome'` |
| `reply.read` | An unread reply is opened - once, by whoever cleared it - or cleared by an outcome saved on the lead | The agent | `because: 'outcome'` when an outcome cleared it |
| `note.added` | A note is saved | The agent | `noteId` - the text stays in `notes`, not copied |
| `outcome.set` | Closed or DNC is saved | The agent | `value`, `dispositionId` |
| `callback.booked` | A callback is booked, in the statement that books it. Seri's is for the lead's holder when an active agent holds the lead, otherwise open to everyone, with no subject | Who booked it; none for one the system booked for a missed call, or Seri's. Subject, whom it is for | `callbackId`, `scheduledAt`; a missed call's `because: 'missed_call'`; Seri's `via: 'seri'`, `callId`, `timeZone` - the lead's zone she agreed it in. Her one-line reason is on the callback (`note`), not here |
| `callback.taken` | A call back nobody had became an agent's - one Seri booked, or one whose agent was deactivated: the first to pick the lead up takes it (`CALLBACKS.md`, "A call back nobody has"), in the same statement as the pick-up. On the lead's timeline | Actor and subject, that agent | `callbackId`, `scheduledAt`; `from`, the deactivated agent |
| `callback.rescheduled` | Its time changes | Who moved it | `callbackId`, `from`, `to` |
| `callback.done` | Marked done, finished by an outcome, or - a missed call's callback - by the lead being got back to | Who did that | `callbackId`, `scheduledAt`, `because`: `outcome`, `called_back`, `texted_back` or `answered` - none when marked done by hand on My Callbacks |
| `callback.reopened` | A done callback is un-done | Who reopened it | `callbackId`, `wasDoneAt` |
| `sms.sent` | An agent's own text went out | The agent | `messageId`, `tookOver` |
| `sms.failed` | EZ Texting refused an agent's text - in the statement that writes the failed message | The agent | - |
| `sms.blocked` | A text refused for a blocked number. It leaves no message row, so this is its only record. An automated text refused so is recorded the same way, in the statement that drops its row (`db/outbound.ts`) | The agent; none for an automated text | - |
| `call.started`, `call.ended`, `call.refused` | A call. A refused call leaves no `calls` row, so the log is its only record. An automated call's say `direction: automated`: refused as `not_found`, `blocked`, `already_called`, `no_script` or `not_test_number`; ended as `failed` with `reason: twilio_refused`, `twilioStatus` and `twilioCode` when Twilio would not place it for the lead's number (`AUTO-CALLS.md`, "How a call is placed"), `reason: not_placed` with the same when it refused for our account's reasons and the lead's call was not used ("When Twilio refuses"), or `reason: no_webhook` when its placing was never confirmed and no webhook named it within 10 minutes ("Traffic") | The agent; none for an automated call | `callSid`, `callId`, `outcome`, `durationSec`, `reason` |
| `call.incoming` | A lead rings our number and an agent is rung; or, for a lead nobody owns, everyone free. From a number we hold no lead for there is no `calls` row, so the log is its only record | None; subject, the agent rung - none when everyone free rang | `callId`, `callSid`; `ring: 'group'` and `rung`, how many; for an unknown number, `phone` and `known: false` |
| `call.taken` | A person accepted a lead's call that rang everyone free - once per call, the first to accept. The call and the lead are theirs from then (`lead.picked_up`, `via: 'call_back'`; `INCOMING-CALLS.md`, "Who rings"). Without it, nothing would say who took a call no one was rung for by name | The person | `callId`, `callSid`; `tookOverFrom` when the lead was someone else's |
| `call.missed` | An incoming call nobody answered | None; subject, the agent it rang - none when it rang everyone free | `callId`, `callSid`; `direction`, `outcome`, `durationSec` when a ring went unanswered; `because: 'no_agent'` when there was nobody to ring |
| `call.held` | A "yes" nobody could take went on hold, waiting for someone on a call or just off one (`AUTO-CALL-TRANSFER.md`, "The hold line") - once per call | None | `callId` |
| `call.transferred` | A person took an automated call's transfer (`AUTO-CALL-TRANSFER.md`, "The transfer") - once per call, whoever held the lead. Without it, a transfer taken by the lead's own holder, or after the browser's pick-up reached the server first, would leave no record | The person | `callId`; `tookOverFrom` when the lead was someone else's |
| `call.answered_by` | Twilio's verdict on who picked up a call we placed - an agent's or an automated one. On an automated call it is also what the voicemail message acted on (`AUTO-CALL-SCRIPT.md`, "Voicemail"); the takeover itself is the call's `script_result`, `voicemail_left`, or `unanswered` for a fax hung up on, written once | None | `callId`, `callSid`, `answeredBy`; `outcome` once the call has ended; `outcomeWas` when the verdict changed an agent's `answered` call to `voicemail` - the row is overwritten, so this is what it said |
| `call.recorded` | A call's recording is ready, and its transcript is put in line | None | `callId`, `callSid`, `recordingSid`, `durationSec` |
| `call.transcribed`, `call.transcript_failed` | The transcript is in, or given up | None | `callId`, `transcriptSid` and the number of `lines`; or the `reason` |
| `dnc.blocked` | A number is blocked: a STOP reply, an agent's DNC outcome, a contact arriving from EZ Texting already opted out, or a lead saying stop on the automated call (reason `call_opt_out`) - once, however often Twilio repeats the request (`AGENT-WORKSPACE.md`, "Blocking a number") | The agent for an outcome; none otherwise | `phone`, `reason`, and `previous` - what the row said before a re-block overwrote it |
| `dnc.released` | A block is lifted: a START reply, the only thing that releases one on a server; on a laptop also `dev:auto-call -- --unblock`, released as `dev_test` | None | `phone`, `releaseReason`, `blockReason`, `blockedAt` |
| `calls.availability_changed` | The "Taking calls" switch went on or off - by the person, or because they signed in or out; or off by the server because they let a transfer ring out (`AUTO-CALL-TRANSFER.md`, "Who is free"). Only when it really changed | The person; none for `missed_transfer`, the person its subject | `on`, and `why`: `by_hand`, `sign_in`, `missed_transfer` (with the `callId`) or `sign_out` |
| `auto_calls.switched_on` | The worker started placing automated calls after they were off, or for the first time - leads that arrive after it are called before those already waiting (`AUTO-CALLS.md`, "When a lead is called"). It overwrites `settings.auto_calls_since`, so the time it replaced is kept here | None - someone set `AUTO_CALLS=on` | `since`, `previousSince` |
| `ai_agent.switched` | Seri switched on or off - `npm run ai-agent -- on\|off` on the server, or the Seri card on Admin > Configuration (`AI-AGENT.md`). Only when it really changed. It overwrites `settings.ai_agent`, so what it said before is kept here | The superadmin who clicked; none from the command | `from` (null when never set), `to`, `via: 'command'` or `'website'` |
| `ai_agent.started` | Seri took an automated call: Twilio's relay connected and named the call. In the transaction that writes `calls.ai_started_at`, once per call. What was said is in `call_ai_turns`, never here | None | `callId`, `knowledgeVersion` |
| `ai_agent.reconnected` | The line to our server dropped on a call of Seri's - the api restarting, or the network - and Twilio opened the relay again: the call was picked back up where it was (`AI-AGENT.md`, "When the line drops"). In the transaction that reads the call's turns. Up to five per call | None | `callId`, `attempt` (Twilio's count, or null), `ended` - she had already chosen her action, which was carried out |
| `ai_agent.ended` | How Seri's part ended - one of her five actions, or `fallback` - in the transaction that writes `calls.ai_ended_with`, once per call. Also when the relay ends her part itself: `end_call` for silence or the time limit, `fallback` when she failed - what the robot counts before pausing. A call back's time and reason are in the `action` turn of `call_ai_turns` | None | `callId`, `action`; `reason` for `end_call` (`no_response`, `time_limit`, or hers); `why` for `fallback` - `model_failed`, `model_slow`, `socket_error`, `relay_failed`, `twilio_failed` (Twilio's side failed before the relay recorded anything, written by `/auto/ai-after`), or, for an end Twilio hands back that cannot be read, `no_handoff`, `unreadable_handoff`, `unknown_action` (`fromHandoff`, `ai/actions.ts`) |
| `dev.test_reset` | A local test script changed a test lead's rows: `ask_again` (`dev-ask-again`: the open conversation expired, a new one started), `number_moved` (`dev-auto-call --again`: this lead's number given to a fresh test lead), `conversation_given` (`dev-auto-call`: a lead with none given one, nothing texted). The scripts refuse production, so this is only ever on a laptop | None | `what`; for `ask_again` the `expired` ids; for `number_moved` `phone` (the number it had), `now` (the one it has) and `freshLeadId` |
| `auth.signed_in`, `auth.signed_out`, `auth.password_changed` | Sign-in, sign-out, a password changed | The person | - |
| `auth.sign_in_failed` | A refused sign-in | None | The `email` tried and `why`. Never the password |
| `user.created`, `user.updated`, `user.password_reset` | A superadmin changes an agent's account | The superadmin; subject, the account | `created`: `email`, `name`, `role`. `updated`: `changes`, each field as `{ from, to }`. `password_reset`: nothing more. Never a password |

## Not recorded here

| What | Its record |
|---|---|
| The automated SMS flow - every question, reply and thanks; the first questions the resend after an outage sends (`POLLER.md`); the text after a missed call; the link a lead asked for on the automated call | Its row in `messages` |
| A lead arriving | `leads` |
| A conversation completing or expiring | `conversations` |
| Each answer a lead gives by text | `conversation_answers` - add-only, tied to the text it was read from |
| Each answer on an automated call | `call_answers` - add-only, with what Twilio heard |
| Each turn of Seri's conversation | `call_ai_turns` - add-only |
| Each ring of a lead on hold to someone who came free | `call_offers` - who, when, how it ended |
| Each robot call the worker places | Its `call.started`, as for one placed by hand |
| A reply not counted because it arrived before our text had gone out | Its row in `messages`, and the log line `reply.before_our_text` (`LOGGING.md`) |
| Whether a browser can take a call right now (`users.ringable_until`) | Nothing: it is the present moment, said by each open browser every half minute and overwritten each time - nobody did anything. The "Taking calls" switch, which a person does turn on and off, is recorded (`calls.availability_changed`) |

## How a record is written

A record written separately could say something happened that was rolled back, or
miss something that was not.

| Where the action is | How its record is written | Example |
|---|---|---|
| One statement | A CTE in that same statement | Picking up a lead is one `UPDATE`, so two agents cannot both win; its record is in the statement (`db/claims.ts`) and the race rule holds |
| Several statements | The same transaction | An outcome (`db/dispositions.ts`), an agent's text, starting a call, a lead calling in. The end of a call is one statement writing the call's end, the callback a missed call books and all three records (`finishCall`, `db/calls.ts`) |
| Sign-ins and account changes | `deps.activity` in the routes, just after the change rather than atomically with it - the user store is an interface the tests replace | `api/auth/` |

## Add-only tables

A record that can be edited is not proof. A trigger refuses every `UPDATE` and
`DELETE` on these, from the app, a script or someone in `psql`:

```
activity_log is add-only: rows cannot be changed or deleted
```

| Table | Trigger | Refuses |
|---|---|---|
| `activity_log` | `activity_log_add_only` | Every change and delete |
| `webhook_events` | `webhook_events_add_only` | Every change and delete |
| `conversation_answers` | `conversation_answers_add_only` | Every change and delete |
| `call_answers` | `call_answers_add_only` | Every change and delete |
| `call_ai_turns` | `call_ai_turns_add_only` | Every change and delete |
| `call_offers` | `call_offers_end_once`, `call_offers_never_deleted` | Anything but writing an open offer's end once (`call_offers: only an offer's end can be written`, `call_offers: an ended offer cannot be changed`), and every delete (`call_offers: rows cannot be deleted`) |

## The raw webhook archive

`webhook_events`: every request EZ Texting and Twilio send, stored before anything
is decided about it - including the ones we go on to ignore, and the replies to
the client's own campaigns that EZ Texting delivers to us (`EZTEXTING-API.md`):
they are what was sent to us.

| Source | Archived | Not archived |
|---|---|---|
| EZ Texting | After the path token is checked, and outside the handler's transaction, so a request that is ignored or fails is still on record | A wrong-token request - it is not EZ Texting's |
| Twilio | Once the signature is verified. A failure to archive is logged, `twilio.archive_failed`, and does not stop the call | A request whose signature fails |

**What is kept is the body as our server read it, not the request's bytes.** EZ
Texting's JSON is parsed by `express.json` and Twilio's form by
`express.urlencoded` before the route sees it, and the archive writes that back
out as JSON (`archiveWebhook`, `db/activity.ts`). Every field and value is there;
the whitespace, how a number was written, and a key EZ Texting sent twice - JSON
parsing keeps the last - are not. A field Twilio sends twice comes back as a list
of both. Keeping the raw bytes would mean reading the body before the parser does;
nothing has needed more than the fields.

**`JSON`, not `JSONB`.** JSONB reorders keys and drops duplicates; this is kept as
proof of what was sent, so it keeps the keys in the order they came. The live
check caught the difference.

## A lead with history cannot be deleted

No foreign key to `leads` cascades, so a delete is refused while any row still
points at the lead. Nothing in the app deletes a lead; the database refuses rather
than relying on that.

**Locally, to start over,** delete nothing - empty the tables:

```sql
TRUNCATE leads, dnc_list, webhook_events RESTART IDENTITY CASCADE;
```

`TRUNCATE` is not stopped by the add-only triggers, which is what makes a local
reset possible. It needs the table owner's rights. Never run it on production.

## What the log does not cover

| Not covered | Where instead |
|---|---|
| Call audio | Recorded when the transcription service is set; the audio stays at Twilio, and we keep its id and the transcript (`call_recordings`, `call_transcripts`). The lead hears a recording notice first - `TWILIO.md` |
| Losing the database | RDS: automatic backups with enough retention, deletion protection on the instance, and optionally a daily dump to S3 - AWS settings, checked by Jeel (`ARCHITECTURE.md`) |
| The table owner | Someone with the owner's rights can `TRUNCATE` a table or drop a trigger. Production's database user should be the only holder of those rights, and nobody should use it by hand - `WORKFLOW.md`, "Migrations" |
| Application logs | `LOGGING.md`'s JSON lines go to CloudWatch with their own retention (`DEPLOY.md`). They are for operations; the activity log is the record |
| A screen for the whole log | A lead's entries with no row of their own are on its timeline, labelled `LOG` (`TIMELINE.md`, "Log entries"); sign-ins, account changes and DNC history have no screen and are queried in the database ("Reading the log") |
| Reading | Who opened which lead is not recorded, only who acted on it |

## Testing

| What | Where |
|---|---|
| A lead picked up and released, a reply read, a note, an outcome, a call back booked, moved, done and reopened, a call started, ended and refused, a block and its release - the poller's block of an opted-out arrival included - Seri's switch, a sign-in; nothing recorded when nothing changed; the log and the archive refuse edits and deletes; a lead with history cannot be deleted | `scripts/activity-live-check.ts` |
| `call.incoming`, `call.missed`, `call.taken`, `call.answered_by`, `call.recorded`, `call.transcribed`, `call.transcript_failed`; the callback a missed call books and what finishes it (`called_back`, `answered`); `lead.picked_up` with `via: 'call_back'` | `scripts/calls-live-check.ts` |
| An agent's own text: `sms.sent` with the take-over, `sms.failed`, `sms.blocked`; `callback.done` with `texted_back` | `scripts/agent-sms-live-check.ts` |
| An automated text refused for a blocked number: `sms.blocked` by nobody | `scripts/lead-texts-live-check.ts` |
| The robot's calls: `call.transferred`, `call.held`, `lead.picked_up` with `via: 'transfer'`, a stop's `dnc.blocked` | `scripts/auto-calls-live-check.ts` |
| `auto_calls.switched_on`; `call.ended` with `no_webhook` | `scripts/auto-dial-live-check.ts` |
| `calls.availability_changed` | `scripts/presence-live-check.ts` |
| `callback.taken` | `scripts/queue-live-check.ts` |
| Seri's part: `ai_agent.started`, `ai_agent.ended`, `ai_agent.reconnected`, her `callback.booked` | `scripts/ai-agent-live-check.ts`, and `npm run e2e` |
| The claim race still holds with the record in the statement | `scripts/claims-live-check.ts` |
| `auth.sign_in_failed`, `auth.signed_out`, `auth.password_changed`, `user.created`, `user.updated`, `user.password_reset` - proved only here, through the routes' recorder with no database - and that no password is ever recorded | `src/api/__tests__/activity.test.ts` |
| The archive: kept for an ignored request, not for a wrong token | `src/api/__tests__/webhooks.test.ts`, `calls.test.ts` |
| The timeline shows a log entry once, not twice | `scripts/timeline-live-check.ts` |
| The wording on screen | `frontend/src/components/Timeline.test.tsx` |
| `dev.test_reset` | No test: the scripts that write it run only on a laptop |

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
WHERE source = 'eztexting' AND payload->>'fromNumber' = '16025550147' ORDER BY id;
```

## Decisions

| Decision | By | Date |
|---|---|---|
| Nothing may be lost: whatever action happens, all of it is tracked - every action a row in the activity log, written with the action, and nothing overwrites the only record of something | Jeel | 2026-10-01 |
| Every inbound webhook is kept as received, and a lead with history cannot be deleted | Jeel | 2026-10-01 |

## How to add an entry

1. Add the action to `ACTIVITY_ACTIONS` in `backend/src/core/activity.ts` first, so
   the vocabulary stays in one place and a typo is a compile error.
2. Write its row in the same statement or transaction as the action
   (`recordActivity`, or the activity insert inside the statement), recording only
   what changed, with whatever the action overwrites in `detail`. Never a password,
   a token or a message body.
3. Prove it in the live check of its area - or, for an account action, in
   `src/api/__tests__/activity.test.ts` - and add it to "Testing".
4. In the same commit: its row in "The actions", and a History line.

## History

- 2026-11-27 · Rewritten as a reference: the actions table checked against `ACTIVITY_ACTIONS` - 41 actions, not 40; every action said to be proved by a test, but `dev.test_reset` is not, and now says so; the screen's `LOG` entries handed to `TIMELINE.md`; counts dropped · D10
- 2026-11-24 · `ai_agent.switched` also from the Seri card on Admin > Configuration, with the superadmin as actor and `via: 'website'`
- 2026-11-23 · `dev.test_reset`: the dev scripts wrote with no record, and the number move overwrote the only record of the number a lead had · review Q9
- 2026-11-23 · `callback.taken` also for a call back whose agent was deactivated, with `from` · review D2
- 2026-11-23 · The archive described as the body our server read, written back as JSON - it had said "the text that arrived" · review R13
- 2026-11-23 · Each check named with the actions it proves; `sms.sent`, the agent's `sms.blocked` and `call.transcript_failed`, proved by no live check, now are; the six account actions proved through the routes' recorder · review R4
- 2026-11-22 · `sms.failed` written in the same statement as the failed message - it was two writes · review M12
- 2026-11-22 · An automated text refused for a blocked number recorded as `sms.blocked` by nobody · review M41
- 2026-11-22 · `reply.read` also when an outcome clears the unread reply · review M20
- 2026-11-13 · `ai_agent.reconnected`: a call of Seri's picked back up when the line drops
- 2026-11-12 · `callback.taken`, a call back Seri booked taken by the first to pick the lead up · A16
- 2026-11-12 · `callback.booked` for a call back Seri booked, with no actor · A15
- 2026-11-12 · `ai_agent.ended` with `twilio_failed`, written by `/auto/ai-after` · A14
- 2026-11-12 · `ai_agent.started` and `ai_agent.ended`, the relay's own endings included · A10, A11, A12
- 2026-11-11 · `ai_agent.switched`, from the server command · A01
- 2026-10-29 · `call.ended` with `reason: not_placed` - an account problem does not use up the lead's call · T28
- 2026-10-24 · `call.taken`, and `call.incoming` and `call.missed` for a lead calling back whom nobody owns · T19
- 2026-10-24 · `auto_calls.switched_on`, and `call.ended` with `no_webhook` · T20
- 2026-10-24 · `call.answered_by` on an automated call is what the voicemail message acted on · T18
- 2026-10-22 · `call_offers`: ended once, never deleted · T17
- 2026-10-21 · `call.held` · T16
- 2026-10-20 · `call.transferred`, and `lead.picked_up` with `via: 'transfer'`; `calls.availability_changed` with `missed_transfer` · T15a, T15c
- 2026-10-19 · `dnc.blocked` for a stop said on the automated call, by the system, once · T13
- 2026-10-18 · Automated calls' `call.started`, `call.ended` and `call.refused`, with no actor; `calls.availability_changed`; `call_answers` add-only; `users.ringable_until` deliberately not recorded · T9, T10, T12
- 2026-10-08 · The Release button replaces Back to queue as what releases a lead
- 2026-10-05 · `conversation_answers` add-only · migration 012
- 2026-10-02 · `call.answered_by`, `call.recorded`, `call.transcribed`, `call.transcript_failed`
- 2026-10-01 · Built: `activity_log`, `webhook_events`, the add-only triggers, and leads that cannot be deleted with their history (migration 006). Most records were already permanent - every text, call, note and outcome is a row nothing edits - but three things were lost: **who held a lead, and when** (pick up and release overwrite `leads.assigned_to` and `assigned_at`, so after a release nothing said Maya held the lead from 2:00 to 2:40); **a callback's original time** (rescheduling overwrites `callbacks.scheduled_at`, reopening clears `done_at`); and **an earlier block** (re-blocking a number reuses its row, replacing when and why it was first blocked and that it was ever released). Three things were never captured at all: who signed in, who changed an agent's account, and what EZ Texting and Twilio actually sent - only what we made of it. A contact arriving already opted out left no record until that day. Texts, calls, notes, outcomes, callbacks and conversations had pointed at their lead with `ON DELETE CASCADE` · Jeel: data is kept as proof
