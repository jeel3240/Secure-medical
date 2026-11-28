# Database schema

Every table in the app's Postgres database, one section each: its columns, what
each means, its constraints and indexes, and the migration that made it. The
migrations in `backend/src/db/migrations/` - `001` to `025`, run in order by
`backend/scripts/migrate.js` - are the source of truth; this doc is checked
against them. What a table is *for*, and the rules the code keeps with it, are in
the doc named beside it.

Everything hangs off `leads.id`. No foreign key to `leads` cascades, so a lead
with history cannot be deleted (`AUDIT.md`, "A lead with history cannot be
deleted"). Times are `TIMESTAMPTZ`; "default now()" is the time the row was
written.

## Tables

| Table | Holds | Owner doc |
|---|---|---|
| `users` | Agents and superadmins | `AUTH.md` |
| `leads` | One person, pulled from EZ Texting | `POLLER.md` |
| `conversations` | Where a lead is in its SMS flow | `STATE-MACHINE.md` |
| `messages` | Every text in or out | `WEBHOOKS.md`, `STATE-MACHINE.md` |
| `calls` | Every call: an agent's, a lead's, the robot's | `TWILIO.md`, `AUTO-CALLS.md` |
| `dispositions` | An agent's outcome on a lead | `AGENT-WORKSPACE.md` |
| `notes` | An agent's notes on a lead | `AGENT-WORKSPACE.md` |
| `callbacks` | Scheduled call backs | `CALLBACKS.md` |
| `dnc_list` | Numbers that must never be contacted | `AGENT-WORKSPACE.md`, "Blocking a number"; `STATE-MACHINE.md`, "Opting back in" |
| `settings` | Key/value configuration | this doc, "`settings` rows" |
| `scoring_rules` | The first flow's points - not read | `FLOWS.md` |
| `tiers` | HOT / WARM / LOW score bands | `STATE-MACHINE.md`, "Scoring" |
| `activity_log` | One row per action - add-only | `AUDIT.md` |
| `webhook_events` | Every webhook as received - add-only | `AUDIT.md` |
| `call_recordings` | A call's recording at Twilio | `TWILIO.md`, "Recordings and transcripts" |
| `call_transcripts` | A recording's text | `TWILIO.md`, "Recordings and transcripts" |
| `flows`, `flow_questions`, `flow_choices` | The SMS scripts, as rows | `FLOWS.md` |
| `conversation_answers` | Each answer a lead gave by text - add-only | `FLOWS.md` |
| `call_scripts`, `call_steps`, `call_choices` | The automated call's script, as rows | `AUTO-CALL-SCRIPT.md`, "The script" |
| `call_answers` | Each answer on an automated call - add-only | `AUTO-CALL-SCRIPT.md`, "Understanding an answer" |
| `call_offers` | Each ring of a lead on hold to someone who came free | `AUTO-CALL-TRANSFER.md`, "The hold line" |
| `call_ai_turns` | Each turn of Seri's conversation - add-only | `AI-AGENT.md` |
| `schema_migrations` | Which migration files have run | `WORKFLOW.md`, "Migrations" |

## `users`

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 001 |
| `email` | Sign-in address, stored lower-cased so sign-in ignores case | not null, unique | 001 |
| `password_hash` | bcrypt hash (`AUTH.md`) | not null | 001 |
| `name` | Shown on every screen | not null | 001 |
| `role` | `superadmin` or `agent` | check | 001 |
| `is_active` | False once deactivated | not null, default true | 001 |
| `must_change_password` | The next sign-in must set a new password | not null, default false | 001 |
| `session_version` | Copied into every session token at sign-in; a token whose version no longer matches is refused. Bumped on deactivation, a password reset by an admin, a password change and sign-out, which signs the person out everywhere (`AUTH.md`) | not null, default 0 | 001 |
| `last_login_at` | Last sign-in; shown on Admin > Agents | | 001 |
| `created_at`, `updated_at` | | not null, default now() | 001 |
| `ringable_until` | Until when this person's browser can be rung: each open browser says so every 30 seconds, and its word holds two minutes; NULL is not available. Cleared whenever `session_version` is bumped. The present moment, not a record, so not in the activity log (`AUTO-CALL-TRANSFER.md`, "Who is free") | | 016 |
| `taking_calls` | The "Taking calls" switch; turned off at every sign-in and sign-out | not null, default false | 017 |
| `taking_calls_at` | When the switch last changed, either way. Every change is also a `calls.availability_changed` row | | 017 |
| `taking_calls_why` | Why it is as it is now: `by_hand`, `sign_in`, `sign_out`, or `missed_transfer` - the server turned it off after the person let a transfer ring out. The screen reads it to say "Missed a transfer" | check | 017 |

## `leads`

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 001 |
| `phone` | E.164, `+15551234567`. The only stable identity: EZ Texting's contacts have no id of their own, and send the number without the `+` (`EZTEXTING-API.md`) | not null, unique | 001 |
| `first_name`, `last_name`, `email` | From the contact; may be empty | | 001 |
| `source` | How the contact was added to EZ Texting - `API` for a partner's lead | | 001 |
| `group_id`, `group_name` | The EZ Texting group it arrived in. Both are kept: the API's group filter matches loosely, so membership is checked again by exact name (`EZTEXTING-API.md`) | | 001 |
| `ezt_added_at` | The contact's `createdAt` at EZ Texting - not `created_at`, when we first saw it. The poller's checkpoint is on this (`POLLER.md`) | | 001 |
| `previous_lead_id` | Unused. Meant to link a re-delivered lead to an earlier row; one person is one lead instead (`STATE-MACHINE.md`, "A number that comes back"). Removed with the buckets work (`BUCKETS.md`, "The database") | references `leads` | 001 |
| `assigned_to`, `assigned_at` | Who has claimed the lead, and since when. Both cleared on release; a claim never expires (`AGENT-WORKSPACE.md`) | references `users` | 001 |
| `has_unread_inbound` | A person has to read a reply - the queue's *Inbound reply* (`STATE-MACHINE.md`, "Which replies need a person"; `QUEUE.md`) | not null, default false | 001 |
| `created_at`, `updated_at` | | not null, default now() | 001 |

Indexes: `idx_leads_assigned_to`, `idx_leads_created_at` (001); `idx_leads_received`
on `(COALESCE(ezt_added_at, created_at) DESC, id DESC)`, the order Admin > Leads
lists them in (013).

## `conversations`

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 001 |
| `lead_id` | | not null, references `leads` | 001 |
| `status` | `open`, `completed`, `expired`, `suppressed` or `review` | check | 001 |
| `step` | The current question's `position` - 10, 11, 20, 30 - for screens that say "On Q2". Screens name a question by its key (`FLOWS.md`) | no check | 001 |
| `q1`, `q2`, `q3` | The first flow's answers, as numbers. Not read: answers are `conversation_answers` | | 001 |
| `q1_label`, `q2_label`, `q3_label` | The word chosen, beside each number. Not read | | 009 |
| `invalid_count` | Unclear replies so far | not null, default 0 | 001 |
| `score`, `tier` | The running score and its tier, updated on every reply (`STATE-MACHINE.md`, "Scoring") | `tier`: check `HOT`, `WARM`, `LOW` | 001 |
| `expires_at` | When the window to reply to the last text closes - set by each successful send, not when the row is made (`STATE-MACHINE.md`, "Expiry") | | 001 |
| `created_at`, `updated_at` | | not null, default now() | 001 |
| `agent_took_over_at` | When an agent first texted the lead while it was open: the questions stop (`STATE-MACHINE.md` rule 2b). A time, not a status, so the status and all that reads it are unchanged | | 003 |
| `completed_at` | When the lead finished the questions, whichever way the flow ended; NULL otherwise. Stamped by `api/reply-flow.ts` the first time the conversation is saved `completed`, and kept on later saves. Admin > Overview counts Completed by it | | 004 |
| `flow_id` | The flow it follows | references `flows` | 012 |
| `current_question_id` | The question the lead is on - or stopped at, once expired or in review. NULL once finished, and for a suppressed one | with `flow_id`, references `flow_questions (id, flow_id)`: `conversations_question_in_flow` | 012 |
| `question_sent_at` | When the text the lead has to answer went out; NULL while we owe them one (`STATE-MACHINE.md` rule 2c) | | 012 |
| `end_outcome` | How the flow ended - the last choice's `ending`: `completed`, `offers`, `wants_contact`, `declined`. NULL while open, and for expired, suppressed and review | check | 012 |

Indexes: `one_open_conversation_per_lead`, unique on `lead_id` where `status = 'open'` -
only one open conversation per phone, ever, since `leads.phone` is unique;
`idx_conversations_status`, `idx_conversations_lead_id` (001).

Rule 2d, a phone call taking the questions over, has no column: it is worked out
from `call_answers`, `calls` and Seri's turns in `call_ai_turns`
(`phoneTookOverAtSql`, `db/lead-state.ts`).

## `messages`

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 001 |
| `lead_id` | | not null, references `leads` | 001 |
| `direction` | `inbound` or `outbound` | check | 001 |
| `body` | The text | not null | 001 |
| `ezt_message_id` | Outbound: the id EZ Texting's send returned | unique where outbound: `messages_ezt_message_id_outbound` | 001 |
| `in_reply_to_ezt_id` | Inbound: the webhook's `id` - the id of *our* message being replied to, not of the reply (`EZTEXTING-API.md`). Not unique: a lead may reply twice to one question | | 001 |
| `from_number`, `received_at` | Inbound: the sender, and EZ Texting's arrival time - together the dedupe key, since EZ Texting retries and one phone cannot send twice in a millisecond (`WEBHOOKS.md`) | unique together where inbound: `messages_inbound_dedupe` | 001 |
| `sent_by` | The agent who sent it; NULL for an automated text and for inbound | references `users` | 001 |
| `delivery_status` | `sending` from the row being written until EZ Texting's id is saved; `failed` for a send EZ Texting refused, with no id; NULL once sent. See "Columns with no check" | | 001 |
| `created_at` | | not null, default now() | 001 |

Indexes: `idx_messages_lead_id` on `(lead_id, created_at DESC)` (001);
`idx_messages_agent_sent` on `lead_id` where `sent_by IS NOT NULL` (013).

## `calls`

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 001 |
| `lead_id` | | not null, references `leads` | 001 |
| `agent_id` | For an agent's call, the agent; for an incoming call, the agent it rang - none when it rang nobody, and while it rings everyone free, until one of them takes it (`takeIncomingCall`); for an automated call, none until a person takes its transfer, then theirs | references `users`; `calls_outbound_has_agent`: `direction <> 'outbound' OR agent_id IS NOT NULL` | 001; nullable 007, reworded 014 |
| `twilio_call_sid` | Twilio's id for the call's **first** leg: the browser's for a call an agent placed, the lead's for one we received, and the lead's leg for an automated call. Unique, which is what makes a retried webhook safe (`ON CONFLICT (twilio_call_sid) DO NOTHING`, `db/calls.ts`) | unique | 001 |
| `started_at` | When Twilio asked us how to connect the call; for an automated call, when its row was written, just before Twilio was asked | | 001 |
| `ended_at` | When Twilio reported the far leg ended - the lead's for a call we placed, the agent's for one we received - or at once for an incoming call that rang nobody; for a ring to everyone free, when the whole ring's end was reported (`/incoming/after`). Also set from Twilio's own record for a call whose end never came, 15 minutes on (`TWILIO.md`, "Calls whose end never came"). NULL while in progress | | 001 |
| `duration_sec` | Seconds of conversation: 0 unless answered (`talkSeconds`, `core/calls.ts`), and kept for a voicemail - how long the agent's message ran | | 001 |
| `outcome` | How the call ended: `answered`, `no_answer`, `busy`, `failed`, `canceled` - mapped from Twilio's statuses - `voicemail` for a call we placed that a machine picked up (an automated one only when Twilio's verdict took it over, `TAKEN_BY_VERDICT_SQL`), and `missed` for an incoming call nobody answered. NULL while it is going (`CALL_OUTCOMES`, `core/calls.ts`) | no check | 001; `missed` 007; `voicemail` 010 |
| `created_at` | | not null, default now() | 001 |
| `direction` | `outbound` - an agent's, from the browser; `inbound` - a lead calling us; `automated` - placed by the server | not null, default `outbound`; check | 007, 014 |
| `answered_by` | Twilio's verdict on who picked up a call we placed: `human`, `machine`, `fax`, `unknown`. NULL for an incoming call, one nobody picked up, or one with no verdict (`TWILIO.md`, "Voicemail") | check | 010 |
| `script_result` | How an automated call's script ended: `transferred`, `transfer_missed`, `link_sent`, `not_interested`, `opted_out`, `no_response`, `voicemail_left`, `hung_up`, `unanswered`, `not_placed`, `callback_booked`. Written once (`AUTO-CALLS.md`) | check; `calls_script_result_automated`: automated calls only | 014, 022 |
| `held_at` | When an automated call's lead went on hold. A call is waiting while it has one, no result and no end (`AUTO-CALL-TRANSFER.md`, "The hold line") | `calls_held_is_automated` | 019 |
| `ai_started_at` | When Seri took the call - the relay's `setup` | | 022 |
| `ai_knowledge_version` | The version of her knowledge files on that call (`ai/knowledge.ts`) | `calls_ai_started_with_version`: written with `ai_started_at` | 022 |
| `ai_ended_with` | How her part ended: one of her five actions - `transfer_to_agent`, `book_callback`, `send_link`, `opt_out`, `end_call` - or `fallback`, when she failed and the script took over. The only record of a fallback, since the call then gets the script's result. NULL while she talks, or when the lead hung up first (`AI-AGENT.md`) | check; `calls_ai_ended_after_start` | 022 |

All three `ai_*` columns are only on an automated call (`calls_ai_is_automated`).

Indexes: `idx_calls_lead_id` (001); `calls_one_automated_per_lead`, unique on `lead_id`
where `direction = 'automated'` and `script_result` is not `not_placed` - one robot
call per lead, a call Twilio never placed for our account's reasons left out
(014); `calls_under_way_by_agent` on `agent_id` where `outcome IS NULL`, read by
`FREE_SQL` (017); `calls_on_hold` on `held_at` for the calls waiting now (019);
`calls_ended_by_agent` on `(agent_id, ended_at)`, read by `JUST_OFF_A_CALL_SQL`
(020).

## `dispositions`

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 001 |
| `lead_id` | | not null, references `leads` | 001 |
| `agent_id` | Who saved it | not null, references `users` | 001 |
| `value` | `closed` or `dnc`, the two the route accepts (`core/dispositions.ts`, `DISPOSITIONS`). Older rows may hold a retired value - `sold`, `interested`, `callback_set`, `no_answer`, `voicemail`, `not_interested`, `wrong_number` (`RETIRED_DISPOSITIONS`); they are kept, and still named on screen | not null; no check | 001 |
| `created_at` | | not null, default now() | 001 |
| `reason` | Why it was closed: `sold`, `not_interested` or `wrong_number` (`CLOSE_REASONS`). Null on DNC, on every row from before 025, and on a Closed saved without one while the route still accepts that (`AGENT-WORKSPACE.md`, "Dispositions"). New values, apart from the retired `value`s of the same names | `dispositions_reason_known`: one of the three; `dispositions_reason_only_closed`: null unless `value = 'closed'` | 025 |
| `conversation_id` | The conversation it was saved against: the lead's newest. Filled in by 025 for every older row with the newest started at or before it; 025 stops if an outcome on a lead that has a conversation gets none. Null for a lead with none | references `conversations` (`dispositions_conversation_fk`) | 025 |

Index: `idx_dispositions_lead_id` (001).

## `notes`

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 001 |
| `lead_id` | | not null, references `leads` | 001 |
| `agent_id` | Who wrote it | not null, references `users` | 001 |
| `body` | The note. The app only adds notes (`AGENT-WORKSPACE.md`, "Notes") | not null | 001 |
| `created_at` | | not null, default now() | 001 |

Index: `idx_notes_lead_id` (001).

## `callbacks`

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 001 |
| `lead_id` | | not null, references `leads` | 001 |
| `agent_id` | Whose call back it is. Only Seri's may have none - open to everyone until someone takes it | references `users`; `callbacks_agent_unless_ai` | 001, 022 |
| `scheduled_at` | When to call | not null | 001 |
| `done_at` | When it was finished; NULL while open | | 001 |
| `created_at` | | not null, default now() | 001 |
| `reason` | `booked` - a person booked it; `missed_call` - the system booked it for the agent a missed call rang; `ai_booked` - Seri booked it on an automated call | not null, default `booked`; check | 008, 022 |
| `booked_by_call_id` | The call Seri booked it on - only on hers | references `calls`; `callbacks_ai_names_its_call` | 022 |
| `note` | Seri's one-line reason for whoever calls - "Wants to order antibiotics" - only on hers, written once | `callbacks_note_is_ai`; `callbacks_note_length`, 1 to 200 characters | 023 |

Indexes: `idx_callbacks_agent_id` on `(agent_id, scheduled_at)` (001);
`idx_callbacks_open_missed_call` on `lead_id` for open `missed_call` ones - one open
per lead is a rule of the SQL that books it (`db/calls.ts`), not a constraint
(008); `idx_callbacks_lead_id` (013); `callbacks_one_per_ai_call`, unique on
`booked_by_call_id`, so Twilio asking twice books once (023).

## `dnc_list`

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 001 |
| `phone` | E.164. A row needs no lead: a STOP from a number we hold no lead for is blocked too (`WEBHOOKS.md`) | not null, unique | 001 |
| `reason` | `ezt_opt_out`, `sms_stop`, `agent_disposition` or `call_opt_out` (`db/dnc.ts`) | not null; no check | 001 |
| `added_at` | When it was blocked | not null, default now() | 001 |
| `released_at`, `released_reason` | When and why the block was lifted: `sms_start`, or `dev_test` on a laptop. **Only a row with `released_at IS NULL` blocks anything** | | 002 |

A row is never deleted, so the table can show which numbers were blocked and
when, if the client is ever asked to prove it. A block is lifted by filling in
`released_at`; blocking the number again reuses the row and empties it, and what
the row said before is kept in the `dnc.blocked` activity row (`AUDIT.md`). Every
read - the poller, `sendMessage`, the Admin > Leads status, placing a call, the
callback a missed call would book - filters on `released_at IS NULL`. Who blocked
a number is that activity row's actor; there is no `added_by` column, and none is
planned.

## `settings`

| Column | What | Constraint | Migration |
|---|---|---|---|
| `key` | | primary key | 001 |
| `value` | Always text; each reader parses its own and falls back when it cannot | not null | 001 |
| `updated_at` | When it last changed | not null, default now() | 001 |

The rows are under "`settings` rows", below. Rows are read on every use, so a
migration that changes one takes effect without a restart. They are shown
read-only on Admin > Configuration and changed by migration (`ADMIN.md`).

## `scoring_rules`

Not read: points are on `flow_choices`. Kept as it was.

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 001 |
| `code` | `responded`, `completed`, `q1_1` ... `q3_3` | not null, unique | 001 |
| `label` | `Q1: Supplements` | not null | 001 |
| `question` | 0 for a flat award (`responded`, `completed`), else 1-3 | not null | 001 |
| `choice` | `'1'`, `'2'` or `'3'`; NULL for a flat award | | 001 |
| `points` | | not null | 001 |
| `updated_at` | | not null, default now() | 001 |

## `tiers`

| Column | What | Constraint | Migration |
|---|---|---|---|
| `name` | `HOT`, `WARM`, `LOW` | primary key | 001 |
| `min_score`, `max_score` | The band: 75-100, 45-74, 1-44. A score of 0 has no tier | not null | 001 |
| `sort_order` | 1, 2, 3 | not null | 001 |
| `updated_at` | | not null, default now() | 001 |

## `activity_log`

Add-only: the trigger `activity_log_add_only` refuses every update and delete. The
actions and what each keeps are `AUDIT.md`'s.

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key, bigserial | 006 |
| `at` | When | not null, default now() | 006 |
| `actor_id` | Who did it; NULL when the system did - the poller, a webhook, Twilio | references `users` | 006 |
| `action` | What, as `area.verb`: `lead.picked_up` (`core/activity.ts`, `ACTIVITY_ACTIONS`) | not null; no check | 006 |
| `lead_id` | The lead it was done to, when there is one | references `leads` | 006 |
| `subject_user_id` | The user it was done to: the agent whose claim was released, the account deactivated | references `users` | 006 |
| `detail` | What would otherwise be lost, as JSON | not null, default `{}` | 006 |

Indexes: `activity_log_lead_idx`, `activity_log_actor_idx`, `activity_log_action_idx` (006).

## `webhook_events`

Add-only: `webhook_events_add_only`. What is kept, and why `JSON`, is `AUDIT.md`,
"The raw webhook archive".

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key, bigserial | 006 |
| `received_at` | | not null, default now() | 006 |
| `source` | `eztexting` or `twilio` | not null; no check | 006 |
| `path` | The route, without the secret path segment | not null | 006 |
| `payload` | The body as the server read it | not null, `JSON` | 006 |

Index: `webhook_events_received_idx` on `(source, received_at)` (006).

## `call_recordings`

A recording row never changes. The audio stays at Twilio.

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 011 |
| `call_id` | | not null, references `calls` | 011 |
| `recording_sid` | Twilio's id, `RE…` | not null, unique - Twilio retries the callback | 011 |
| `duration_sec` | | not null, default 0 | 011 |
| `channels` | Two for a recorded call: the agent on one, the lead on the other | not null, default 1 | 011 |
| `created_at` | | not null, default now() | 011 |

Index: `idx_call_recordings_call` (011).

## `call_transcripts`

Written by the worker (`worker/transcripts.ts`); only moves forward, and its text,
once there, is never rewritten.

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 011 |
| `call_id` | | not null, references `calls` | 011 |
| `recording_id` | | not null, unique, references `call_recordings` | 011 |
| `status` | `pending` - asked of the worker; `queued` - Twilio has it; `completed`; `failed` | not null, default `pending`; check | 011 |
| `transcript_sid` | Twilio's id, `GT…`, once Twilio has accepted it | unique | 011 |
| `sentences` | `[{ "speaker": "agent" \| "lead", "text": "...", "startSec": 1.2 }]`, in order | `JSONB` | 011 |
| `attempts`, `error` | Tries so far, and the last error | `attempts` not null, default 0 | 011 |
| `created_at`, `updated_at`, `completed_at` | | | 011 |

Indexes: `idx_call_transcripts_call`; `idx_call_transcripts_open` on `status` for
`pending` and `queued` (011).

## `flows`, `flow_questions`, `flow_choices`

The SMS scripts. What each column does in a flow, and the rules the database
enforces, are `FLOWS.md`'s; the flow new leads get is in `FLOWS.md`, "The
antibiotics flow".

**`flows`** (012)

| Column | What | Constraint |
|---|---|---|
| `id` | | primary key |
| `key` | Stable name for code and logs: `antibiotics` | not null, unique |
| `name` | | not null |
| `ezt_group` | The EZ Texting group whose leads get this flow. Not read: with one active flow every new lead gets it | |
| `responded_points` | Awarded once, on the first reply | not null, check `> 0` |
| `completed_points` | Awarded when the flow ends by a choice whose ending is `completed` | not null, default 0 |
| `review_body` | Sent after a second unclear reply | not null |
| `is_active` | The flow new leads are given | not null, default false; `flows_one_active`: at most one |
| `created_at` | | not null, default now() |

**`flow_questions`** (012)

| Column | What | Constraint |
|---|---|---|
| `id` | | primary key; unique `(id, flow_id)` |
| `flow_id` | | not null, references `flows` |
| `key` | `q1`, `q2`; `q1-a` for a sub-question | not null; unique `(flow_id, key)` |
| `position` | Order, in tens - 10, 20, 30, with 11 for a sub-question; the lowest is first | not null; unique `(flow_id, position)` |
| `body` | The question as the lead reads it; may contain `{first_name}` | not null |
| `clarify_body` | Sent for a reply that is not one of the choices | not null |
| `heading` | What the screens call the answer: `Next step` | not null |

**`flow_choices`** (012)

| Column | What | Constraint |
|---|---|---|
| `id` | | primary key |
| `flow_id` | The question's flow, repeated so both questions can be held to it | not null, references `flows` |
| `question_id` | | not null; with `flow_id`, references `flow_questions (id, flow_id)` |
| `choice` | What the lead types: `1`, `2`, `3` | not null; unique `(question_id, choice)` |
| `label` | What the screens show: `Talk to an agent` | not null |
| `words` | Also accepted as the whole reply, any case | not null, default `{}` |
| `points` | | not null, default 0 |
| `reply_body` | Sent on this answer, before the next question if there is one | |
| `next_question_id` | Where the lead goes next | with `flow_id`, references `flow_questions (id, flow_id)`: `flow_choices_next_in_flow` |
| `ending` | `completed`, `offers`, `wants_contact` or `declined` | check; `flow_choices_next_or_end`: exactly one of `next_question_id` and `ending` |

## `conversation_answers`

One row per answer a lead gave by text, with the question's and choice's words and
points as they were then. Add-only: `conversation_answers_add_only`.

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key, bigserial | 012 |
| `conversation_id` | | not null, references `conversations` | 012 |
| `lead_id` | | not null, references `leads` | 012 |
| `question_id` | | not null, references `flow_questions` | 012 |
| `question_key`, `position`, `heading` | Copied from the question | not null | 012 |
| `choice`, `label`, `points` | Copied from the choice | not null | 012 |
| `message_id` | The text it was read from. NULL only on a row migration 012 copied from the old columns | references `messages` | 012 |
| `created_at` | When it was given - on a copied row, when its conversation was last saved | not null, default now() | 012 |

A question is answered once in a conversation: unique `(conversation_id,
question_id)`. Index: `conversation_answers_lead` (012).

## `call_scripts`, `call_steps`, `call_choices`

The automated call's script, as rows - its own tables, not the SMS flow's
(`AUTO-CALL-SCRIPT.md`, "The script", which also has the script's words).

**`call_scripts`** (015, 019)

| Column | What | Constraint |
|---|---|---|
| `id` | | primary key |
| `key`, `name` | `antibiotics` | `key` not null, unique |
| `voice` | The voice Twilio speaks in: `Google.en-US-Chirp3-HD-Kore` | not null |
| `opt_out_words`, `opt_out_body` | Words that stop the call on any step - or the key 9 - and the line said then | not null |
| `no_response_body` | Said, and the call ended, when a step is not understood twice | not null |
| `voicemail_body` | Left after the beep; `{callback_number}` is read digit by digit | not null |
| `busy_body` | Nobody took a "yes" and nobody is about to be free | not null |
| `hold_body` | Before the music, when someone is on a call | not null |
| `hold_next_body`, `hold_place_body` | The lead's place in line: "You are next.", "You are number {place} in line." | not null (019); `call_scripts_hold_place_says_place`: says `{place}` |
| `link_text` | The text sent on a "yes" to the link | not null |
| `is_active` | The script calls use | not null, default false; `call_scripts_one_active`: at most one |
| `created_at` | | not null, default now() |

**`call_steps`** (015)

| Column | What | Constraint |
|---|---|---|
| `id` | | primary key; unique `(id, script_id)` |
| `script_id` | | not null, references `call_scripts` |
| `key` | `q1`, `q2` | not null; unique `(script_id, key)` |
| `position` | Order, in tens; the lowest is first | not null; unique `(script_id, position)` |
| `heading` | What the screens call it: `Offer` | not null |
| `body` | What is said | not null |
| `repeat_body` | Said when the answer is not understood the first time; asks for keys | not null |

**`call_choices`** (015)

| Column | What | Constraint |
|---|---|---|
| `id` | | primary key |
| `script_id` | The step's script, repeated so both steps can be held to it | not null, references `call_scripts` |
| `step_id` | | not null; with `script_id`, references `call_steps (id, script_id)` |
| `key` | The key that picks it, `0`-`8` - 9 is always stop | not null, check; unique `(step_id, key)` |
| `label` | `Yes` | not null |
| `words` | What may be said for it, found as whole words in the sentence (`core/answers.ts`) | not null, default `{}` |
| `reply_body` | Said on this answer | not null |
| `next_step_id` | Where it leads | with `script_id`, references `call_steps (id, script_id)`: `call_choices_next_in_script` |
| `ending` | `transfer`, `send_link` or `declined` | check; `call_choices_next_or_end`: exactly one of `next_step_id` and `ending` |

## `call_answers`

One row per answer on an automated call. Add-only: `call_answers_add_only`.

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key, bigserial | 015 |
| `call_id`, `lead_id`, `step_id` | | not null; reference `calls`, `leads`, `call_steps` | 015 |
| `step_key` | Copied from the step | not null | 015 |
| `attempt` | 1 when first asked, 2 when asked again | not null, check 1 or 2 | 015 |
| `heard` | What Twilio heard; NULL when nothing was said | | 015 |
| `confidence` | How sure Twilio was, 0 to 1; NULL when it sent none | check 0-1 | 015 |
| `digits` | Keys pressed; NULL when none | | 015 |
| `result` | `choice`, `unclear`, `silence` or `opt_out` | not null, check | 015 |
| `choice_key`, `choice_label` | The choice, with its label as it was then - only for `choice` | check: present exactly for a choice | 015 |
| `created_at` | | not null, default now() | 015 |

One answer per asking: unique `(call_id, step_id, attempt)`, so a request Twilio
sends twice saves one row. Index: `call_answers_lead` (015).

## `call_offers`

Each time a lead waiting on hold rang one person who came free. Written before
Twilio is asked and ended once: the trigger `call_offers_end_once` refuses any
other change and `call_offers_never_deleted` every delete - which is also how a
lead is never offered twice to one person.

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key | 020 |
| `call_id` | The lead's automated call | not null, references `calls` | 020 |
| `agent_id` | Who was rung | not null, references `users` | 020 |
| `offered_at` | | not null, default now() | 020 |
| `ended_at`, `outcome` | How it ended: `taken`, `declined`, `missed` (rang out), `failed` (the ring never completed - Twilio's `failed` or `canceled`, or cut short by the voicemail message), `hung_up`, `expired` (never heard back), `unsent` (never rung - Twilio would not take the redirect, or the call was not ours to ring) | check; `call_offers_ended_with_outcome`: both or neither | 020 |

Indexes: `call_offers_one_live_per_call` and `call_offers_one_live_per_agent`,
unique while open - one ring at a time per lead and per person; `call_offers_by_call`
on `(call_id, agent_id)` (020).

## `call_ai_turns`

One row per turn of Seri's conversation on an automated call, in order by `id` -
for the agent who takes the transfer or the call back. The words are kept here and
never in the logs. Add-only: `call_ai_turns_add_only`. What the relay writes, turn
by turn, is `AI-AGENT.md`'s.

| Column | What | Constraint | Migration |
|---|---|---|---|
| `id` | | primary key, bigserial | 022 |
| `call_id` | | not null, references `calls` | 022 |
| `who` | `lead`, `seri`, `action` (how she ended it, as its `handoffData` JSON) or `system` (the relay's own note: a sentence replaced, an action refused, the stop words heard, a fallback) | not null, check | 022 |
| `text` | What was said - her words without the voice's tone tags (`ai/tone.ts`); a key pressed as `(pressed 1)` | not null | 022 |
| `latency_ms` | On Seri's turns: from the lead's words reaching us to her first sentence going out | check `>= 0`; only on `seri` | 022 |
| `created_at` | | not null, default now() | 022 |
| `data` | The brain's record of a reply, under the note `Record of the reply (the brain)`: the policy's `version`, how the lead was `understood` (`fast`, `openai`, `early`, `refused`), the `acts`, the `moves`, and the call's `record` before and once `decided`. Not the conversation, but some words are in it - an approved answer's text, the time said back and the one first asked for, and the first two words of her last two replies (`openings`), which can be the lead's name. A call whose line dropped picks up from the last one (`recordFromTurns`, `ai/brain.ts`) | `JSONB`; `call_ai_turns_data_on_system`: only on `system` | 024 |

Index: `call_ai_turns_call` on `(call_id, id)` (022).

## `schema_migrations`

Made by `backend/scripts/migrate.js`, not by a migration. The runner takes an
advisory lock, runs each `.sql` file not yet listed, in filename order, each in
its own transaction, and records it; a file is never run twice.

| Column | What | Constraint |
|---|---|---|
| `name` | The file name: `012_flows.sql` | primary key |
| `applied_at` | | not null, default now() |

## `settings` rows

| Key | What | Seeded | Read by |
|---|---|---|---|
| `poll_interval_seconds` | Seconds between worker cycles; read every tick | `60` (001); `30` (005) | `worker/index.ts`, `db/sql.ts` |
| `poll_overlap_minutes` | How far behind its checkpoint each poll reads again; 5 when not above 0 | `5` (001) | `worker/poller.ts` |
| `ezt_poll_checkpoint` | Where the next poll reads back to: the newest contact `createdAt` taken in, held just before the oldest contact that failed (`POLLER.md`, "A cycle"). Written on every poll that read EZ Texting, unchanged when nothing arrived; its `updated_at` is what health and "Synced" read where `ezt_last_read_at` does not exist yet | no migration: the poller writes it | `worker/poller.ts`, `db/poll-state.ts` |
| `ezt_last_read_at` | When the poller last read EZ Texting, failed contacts or not - what health and Admin > Leads' "Synced" call the last poll (`LOGGING.md`, "Health endpoint"). The time is in `value` and `updated_at` alike | no migration: the poller writes it (B06) | `worker/poller.ts`, `db/poll-state.ts`, `db/health.ts`, `db/leads.ts` |
| `expiry_days` | Days a lead has to reply to a text | `7` (001) | `db/sql.ts` (`readExpiryDays`) |
| `max_invalid_before_review` | Unclear replies before a conversation goes to review | `1` (001) | `api/reply-flow.ts` |
| `message_missed_call` | The text after a call to us nobody answered | 007; reworded for eDrugstore by 012 | `db/lead-texts.ts` |
| `question_1`-`question_3`, `message_clarify_1`-`message_clarify_3`, `message_thanks`, `message_review`, `message_stop` | The first flow's words. Not read: a flow's words are in its rows, and EZ Texting sends its own STOP confirmation | 001 | nothing |
| `auto_call_hours_start`, `auto_call_hours_end`, `auto_call_time_zone`, `auto_call_days` | When automated calls go out | `11:00`, `17:00`, `America/Phoenix`, `mon,tue,wed,thu,fri` (015) | `db/call-script.ts` (`readCallHours`) |
| `auto_call_wait_minutes` | How long after the first text, with no reply, a lead is called | `60` (015) | `db/call-script.ts` |
| `auto_call_ring_seconds` | How long people free ring for a "yes" | `25` (015) | `readRingSeconds` |
| `auto_call_hold_max_minutes` | The hold line's safety stop, for a call Twilio never reported as ended | `10` (015) | `readHoldMaxSeconds` |
| `auto_call_min_confidence` | Below this, what Twilio heard is not trusted and the step is asked again | `0.4` (015) | `readMinConfidence` |
| `auto_call_offer_ring_seconds` | How long a lead on hold rings the person who came free | `20` (020) | `readOfferRingSeconds` |
| `auto_call_calls_per_person` | Automated calls at once for each person free; a value that is not a whole number from 1 to 10 is read as 5 | `5` (021) | `readCallsPerPerson` |
| `ai_agent` | Seri's switch, `on` or `off`: `npm run ai-agent -- on\|off`, or the Seri card on Admin > Configuration; each change is an `ai_agent.switched` row (`AI-AGENT.md`) | `off` (022) | `ai/settings.ts` |
| `auto_calls_on` | Whether the worker last started with automated calls on | no migration: the worker writes it | `db/auto-dial.ts` |
| `auto_calls_since` | When automated calls were last switched on: leads that arrived after it are called first (`AUTO-CALLS.md`, "Leads already waiting"). Each switch-on overwrites it; `auto_calls.switched_on` keeps the time it replaced | no migration: the worker writes it | `db/auto-dial.ts` |

## Seeded rows

| Table | What the migrations put in it | Described in |
|---|---|---|
| `tiers` | HOT 75-100, WARM 45-74, LOW 1-44 (001) | `STATE-MACHINE.md`, "Scoring" |
| `scoring_rules` | The first flow's points: Responded +10, Completed +10, Q1 5/10/15, Q2 30/20/5, Q3 35/25/10 (001) | not read |
| `flows`, `flow_questions`, `flow_choices` | `wellness`, the first flow, inactive, built from the rows above; `antibiotics`, active - the flow new leads get (012) | `FLOWS.md`, "The antibiotics flow" |
| `call_scripts`, `call_steps`, `call_choices` | `antibiotics`, active (015, 018, 019) | `AUTO-CALL-SCRIPT.md`, "The script" |
| `settings` | The rows above | "`settings` rows" |

## Columns with no check

These take any value the code writes; the database would accept a typo. The
values are fixed in code instead.

| Column | Values written | Fixed in |
|---|---|---|
| `dispositions.value` | `closed`, `dnc`; older rows a retired value | `core/dispositions.ts` |
| `calls.outcome` | `answered`, `voicemail`, `no_answer`, `busy`, `failed`, `canceled`, `missed` | `core/calls.ts` |
| `dnc_list.reason` | `ezt_opt_out`, `sms_stop`, `agent_disposition`, `call_opt_out` | `db/dnc.ts` |
| `dnc_list.released_reason` | `sms_start`, `dev_test` | `db/dnc.ts` |
| `messages.delivery_status` | `sending`, `failed`, NULL. It stays `sending` when the write after a successful send failed (it counts as sent), or when the send timed out unanswered - it may have gone, so it is neither marked failed nor retried. No status is ever read back from EZ Texting | `db/outbound.ts`, `db/failed-sends.ts` |
| `activity_log.action` | `ACTIVITY_ACTIONS` | `core/activity.ts` |
| `webhook_events.source` | `eztexting`, `twilio` | `db/activity.ts` |
| `settings.value` | Text for every key. `expiry_days = 'banana'` is accepted; its reader takes it as 7, as each reader falls back to its default on a value it cannot use. A deliberate trade at this scale, not an oversight | each reader (`db/sql.ts`, `db/call-script.ts`) |

## How to add an entry

1. Write a new numbered migration in `backend/src/db/migrations/` - the next number
   is in `WORKFLOW.md`, "Where the files stand" - following `WORKFLOW.md`,
   "Migrations". Never edit one that has run on
   production.
2. In the same commit, change this doc: the table's section (a new section and a
   row in "Tables" for a new table), its constraints and indexes with their names,
   a "`settings` rows" row for a new setting, and a History line.
3. A rule the database enforces is proved by a live check against a real Postgres
   (`backend/scripts/live-checks.sh`); a migration that changes existing rows, by
   an upgrade check as well (`TESTING.md`, "Upgrade checks").

## History

- 2026-11-28 · `settings` row `ezt_last_read_at`, the poller's own · B06
- 2026-11-28 · `dispositions.reason` and `dispositions.conversation_id`, with their checks and foreign key (025); the next number is left to `WORKFLOW.md`, "Where the files stand", rather than written here too · B04
- 2026-11-27 · Rewritten as a reference: one section per table, from migrations 001-024. `dispositions.value`'s current values given as `closed` and `dnc` - the old text listed DNC among the retired ones. `ezt_poll_checkpoint`, `auto_calls_on`, `auto_calls_since` and `schema_migrations` added; the claims, unread-reply, take-over, LOW-tier, repeat-lead and connection notes handed to their owners; `expiry_days = 'banana'` no longer said to fail where it is read - every reader falls back to 7 since review M17 · D09
- 2026-11-17 · Migration 024: `call_ai_turns.data`, the new brain's record of each reply, only on a `system` turn · A31
- 2026-11-12 · Migration 023: `callbacks.note`, Seri's reason, and `callbacks_one_per_ai_call` · A15
- 2026-11-11 · Migration 022: Seri's part of a call (`ai_started_at`, `ai_knowledge_version`, `ai_ended_with`), the result `callback_booked`, `call_ai_turns`, the `ai_booked` call back with `booked_by_call_id` and no agent until taken, and the `ai_agent` setting · A08
- 2026-11-02 · Migration 021: `auto_call_calls_per_person`, 5 - on production that day about 200 calls put 3 leads through to a person · T29
- 2026-10-22 · Migration 020: `call_offers`, `calls_ended_by_agent`, `auto_call_offer_ring_seconds` · T17
- 2026-10-20 · Migration 019: the place on hold in the script's words, `calls.held_at`, `calls_on_hold` · T16
- 2026-10-18 · Migration 018, after T12's first real call: the opening says the offer before the question and no longer "This is an automated call"; "won't" and "didn't" written out, as Kore's "won't" sounded like "will"; the voice changed from `Polly.Joanna-Neural` to Google Chirp3-HD Kore. It stops unless each row it changes is as 015 left it · T12, T13
- 2026-10-18 · Migration 017: `taking_calls`, `taking_calls_at`, and `taking_calls_why` (added to 017 before it reached production, T15c); `calls_under_way_by_agent` · T10
- 2026-10-18 · Migration 016: `users.ringable_until` · T9
- 2026-10-18 · Migration 015: the call script as rows, `call_answers`, and the `auto_call_*` settings · T6
- 2026-10-18 · Migration 014: the `automated` direction, `script_result`, `calls_one_automated_per_lead`; `calls_outbound_has_agent` reworded. On 2026-10-29, before release, the index left out `not_placed` calls, so an account problem never uses up a lead's call · T4, T28
- 2026-10-06 · Migration 013: `idx_callbacks_lead_id`, `idx_messages_agent_sent`, `idx_leads_received` - with 50,000 leads each was a read of a whole table, or a sort of every lead, on every refresh (`QUEUE.md`, "How fast it is")
- 2026-10-05 · Migration 012: flows as rows; `antibiotics` the active flow, the first flow kept inactive as `wellness`; every answer copied into `conversation_answers`; `step`'s 1-3 check dropped; `q1`-`q3`, their labels, `scoring_rules` and the question, clarification, stop, thanks and review settings no longer read; `message_missed_call` reworded for eDrugstore. Copied answers carry their conversation's last save time and no `message_id`, as the old columns never recorded either; production held no leads when 012 ran, so there are none there · `FLOWS.md`
- 2026-10-02 · Migration 011: `call_recordings` and `call_transcripts`; migration 010: `calls.answered_by` · `TWILIO.md`
- 2026-10-01 · Migration 009: `q1_label`-`q3_label`, the word chosen; migration 008: `callbacks.reason`; migration 007: `calls.direction`, no `agent_id` for an incoming call, `message_missed_call`
- 2026-10-01 · Migration 006: `activity_log`, `webhook_events`, `refuse_change()`; the foreign keys to `leads` stop cascading, so deleting a lead would no longer delete its texts, calls and notes · `AUDIT.md`
- 2026-09-29 · Migration 005: the poll interval from 60 to 30 seconds, only where it was still the seeded 60
- 2026-09-28 · Migration 004: `conversations.completed_at`, so Admin > Overview counts a lead under the day it finished rather than the day it arrived - then, when the third answer arrived; since 012, whichever way the flow ends. Filled in for completed conversations from the thanks text's time, or `updated_at` when the thanks failed - all five local completed conversations took their thanks' time exactly. The two Phase 3 migrations, 003 and 004, merged into 003 (neither had run on production): `agent_took_over_at`, and clearing the `has_unread_inbound` flags the old every-reply rule left - a message waits for a person only if nothing was sent after it, checked on seeded old-style flags first
- 2026-09-28 · `dispositions.value`: new rows only `closed` or `dnc`; the earlier values retired, their rows kept; no migration, as the column has no check · `AGENT-WORKSPACE.md`, "Dispositions"
- 2026-09-23 · The disposition values found in `DESIGN-PROMPT.md` section 3 - Interested, Callback set, No answer, Voicemail, Not interested, Wrong number, DNC
- 2026-09-22 · Migration 002: `dnc_list.released_at` and `released_reason` - a START lifts a block without deleting it · `STATE-MACHINE.md`, "Opting back in"
- 2026-09-19 · `leads.previous_lead_id` left in place, unused: one person is one lead, a re-delivery becomes a new conversation on it, and "seen before" is worked out from earlier conversations, so `leads.phone` stays unique. It was kept until it was known whether a re-delivered contact's `createdAt` moves - checked 2026-11-27, it does not (`EZTEXTING-API.md`) - and goes with the buckets work · `BUCKETS.md`, B13
- 2026-09-15 · `leads.assigned_at` added to 001, so a superadmin can tell a lead claimed two minutes ago from one held since last week
- 2026-09-14 · `users.session_version` and `last_login_at` added to `001_init.sql` itself, as 001 had not yet run on RDS. A local database made from the earlier 001 lacks them: recreate it (`docker compose down -v`, `up -d`, `npm run migrate` - this deletes local data), or add them with `ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;` and `ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;`
- 2026-09-14 · Migration 001, the starting schema, seeded with the mockup's defaults: the copy, the points, the tiers, a 60-second poll and a 5-minute overlap
