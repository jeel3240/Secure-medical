# Database schema

The migrations in `backend/src/db/migrations/` - `001` to `008`, in order -
are the source of truth for exact columns, types and constraints. `001_init.sql`
is the starting schema; the seven after it add columns, tables and constraints. This explains what the tables are for and the
parts that are not obvious from reading the SQL.

Migrations are plain numbered `.sql` files run by `backend/scripts/migrate.js`,
which records each filename in `schema_migrations` and never re-runs it. Never
edit a migration that has already run against RDS - add a new numbered file.

## Connecting

Both `src/db/pool.ts` and `scripts/migrate.js` pass `ssl:
{ rejectUnauthorized: false }` when `NODE_ENV=production`, and nothing locally.

RDS certificates are signed by Amazon's CA, which Node does not trust by
default. A production `DATABASE_URL` carries `sslmode=require`, so without this
the first connection fails with `self signed certificate in certificate chain`.
The connection is still encrypted; only the issuer check is skipped, which is
acceptable because RDS is reachable only from inside the VPC. Point `ssl.ca` at
the RDS CA bundle if strict verification is ever wanted.

`psql` does not hit this, because it does not verify by default - so a working
`psql` connection is not evidence that the app will connect.

## Tables

| Table | Holds |
|---|---|
| `users` | Agents and superadmins. bcrypt hash, role, active flag, must-change-password flag, last sign-in, session version. |
| `leads` | One person, pulled from EZ Texting. |
| `conversations` | The 3-question SMS flow for a lead, plus its score and tier. |
| `messages` | Every SMS in or out. |
| `calls` | Twilio calls, with duration and outcome. Written since Phase 4 - `TWILIO.md`, "What is saved". `direction` says who called whom. `twilio_call_sid` is the call's first leg: the browser's for a call we placed, the lead's for one we received. An incoming call that rang nobody has no `agent_id`; an outgoing one always has - the `calls_outbound_has_agent` check (migration 007). |
| `dispositions` | What an agent decided after contact. |
| `notes` | Free text an agent wrote about a lead. |
| `callbacks` | Scheduled follow-ups. `reason` is `booked` - a person booked it - or `missed_call`, booked by the system for the agent a missed call rang (migration 008). One open `missed_call` callback per lead is a rule in the SQL that books it (`db/calls.ts`), not a constraint; the partial index `idx_callbacks_open_missed_call` serves that lookup. |
| `dnc_list` | Phones that must never be contacted. |
| `settings` | Key/value config, admin-editable. |
| `scoring_rules` | Points per answer, admin-editable. |
| `tiers` | HOT/WARM/LOW score bands, admin-editable. |
| `activity_log` | One row per action a person or the system took - who, what, when, and what would otherwise be overwritten. Add-only: a trigger refuses every update and delete. Migration 006, `AUDIT.md`. |
| `webhook_events` | Every request EZ Texting and Twilio sent, as it arrived. Add-only. Migration 006, `AUDIT.md`. |

Everything hangs off `leads.id`. **A lead with history cannot be deleted** -
migration 006, 2026-10-01. The foreign keys were `ON DELETE CASCADE`, so
deleting a lead would have removed its texts, calls and notes with it; the
company keeps data as proof, so the database now refuses the delete instead
(`AUDIT.md`). To reset a local database, `TRUNCATE` - see that doc.

## Things worth knowing

**`users.session_version` ends sessions.** Every session token carries the
version current at sign-in, and the API rejects a token whose version no longer
matches. Bumping it signs the user out everywhere at once - on deactivation,
admin password reset, password change and sign-out. AUTH.md has the full table.
`users.last_login_at` feeds the admin Agents list.

Both columns were added to `001_init.sql` directly rather than in a new
migration, because 001 had not yet run against RDS. A local database created
from the earlier 001 lacks them. Either recreate it (`docker compose down -v`,
then `up -d` and `npm run migrate` - this deletes local data) or add them by
hand:

```sql
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
```

**`dnc_list` is the permanent record of blocked numbers.** One row per phone,
with the reason and when it was added. Rows are never deleted - the design brief
keeps deletion out of v1 - so the table can show the client which numbers were
blocked and when, if they are ever asked to prove it.

A block is lifted by filling in `released_at` and `released_reason`
(`002_dnc_release.sql`), not by deleting the row, so both dates survive. **Only
a row with `released_at IS NULL` blocks anything**; every read - the poller,
`sendMessage`, the Admin > Leads status, placing a call, and the callback a
missed call would book - filters on it. Today the only thing
that releases a row is a lead texting START; see STATE-MACHINE.md, "Opting back
in".

It has no `added_by`, and none is planned. An agent can now mark a number DNC
(reason `agent_disposition`); who did is the actor of the `dnc.blocked` row in
`activity_log` (`AUDIT.md`), not a column here.

**A `dnc_list` row needs no lead.** The webhook writes one for a STOP from a
number we hold no lead for, because the subscription covers the whole EZ Texting
account and those replies belong to the client's other campaigns. Blocking the
number costs nothing and protects us if it is delivered as a partner lead later.
See WEBHOOKS.md.

**Phone is the identity.** The EZ Texting contacts API returns no per-contact
id, so there is nothing else stable to key on. `leads.phone` is unique and
stored E.164 (`+15551234567`), while EZ Texting returns it without the `+`.

**Only one open conversation per phone, ever.** Enforced by a partial unique
index on `conversations (lead_id) WHERE status = 'open'`. Non-open rows are
unconstrained, so expired and completed history accumulates freely alongside.

**`ezt_added_at` is the poller's checkpoint field.** It holds the contact's
`createdAt` from EZ Texting, which is not the same as `created_at` (when we
first saw it). The poller checkpoints on the former.

**`group_id` and `group_name` are both stored.** The API's group filter matches
loosely, so group membership is re-verified in code after fetching. Keeping the
id lets that check be exact.

**`scoring_rules.question = 0`** means a flat award rather than an answer to a
question - `responded` and `completed`. Questions 1-3 carry a `choice` of
`'1'`, `'2'` or `'3'`.

**`previous_lead_id` is unused and is expected to be dropped.** It exists for
the resold-lead case in CLAUDE.md section 6, which describes one lead row per
delivery, linked back to the previous one. The decision since is the opposite:
one person is one lead row, and a re-delivery months later becomes a new
conversation on the existing lead.

So `leads.phone` stays unique, `conversations` becomes one-to-many, and "seen
before" is derived from a lead's prior conversations rather than stored. The
column comes out in the migration that implements this. The rules are in
STATE-MACHINE.md, "A number that comes back"; what detection depends on is in
POLLER.md.

It is deliberately still here rather than removed now: repeat leads are a
future item (CLAUDE.md §10). Half of what they depend on is settled - EZ Texting
does not allow two contacts with the same number, so a re-delivery updates the
existing contact (verified 2026-09-19) - but whether that update moves
`createdAt` is not. Removing the column early would mean re-adding it if the
answer changes the shape.

**`messages` is keyed differently by direction.** Outbound rows carry the id
returned by the send API in `ezt_message_id`, unique via a partial index on
`direction = 'outbound'`. Inbound rows leave it null and instead fill
`in_reply_to_ezt_id`, `from_number` and `received_at`, with a separate unique
index on `(from_number, received_at)`.

The split exists because the inbound webhook's `id` is not an id for the reply -
it is the id of our message being replied to, so two replies to the same
question carry the same value. A single unique column across both directions
would reject the second reply. `in_reply_to_ezt_id` is deliberately not unique.
EZTEXTING-API.md has the evidence.

**`leads.has_unread_inbound` means a person has to read a reply** - since
2026-09-28. The webhook sets it only when the questions cannot handle a message:
after the conversation ended, or to an agent who took it over
(`STATE-MACHINE.md`, "Which replies need a person"). Picking the lead clears it.
It decides who is in the queue, as *Inbound reply*.

It used to be set on every inbound message, answers included. Migration 003
(its second part - it was 004 until the two were merged) cleared the flags that rule left behind, by one test: a lead's message waits for
a person only if nothing was sent to them after it. Answered "1" and got
question 2 - cleared. Finished, then texted again - kept. An answer whose next
question failed to send is kept on purpose: the flow never answered it. Checked
on seeded old-style flags before it shipped.

**Leads are claimed and released explicitly.** An agent claims a lead, which
sets `assigned_to` and `assigned_at`. Everyone else sees it as in progress. The
agent releases it by clearing both, and it returns to the queue. A superadmin
can clear anyone's claim.

Claims never expire. With ten agents who know each other, a timer risks taking
a lead off someone who stepped away, and manual reassignment is enough.
`assigned_at` is still needed so a superadmin can tell a lead claimed two
minutes ago from one held since last week - without it both look identical.

*(Built in Phase 3: `db/claims.ts` sets both on Pick up and clears both on
release.)*

A released lead carries no marker on its row. The release itself - who held it,
since when, and whether it was forced - is a `lead.released` row in
`activity_log` and a line on the timeline, beside the calls, messages, notes
and dispositions. A lead that
is genuinely bad should get a disposition rather than being released.

**Four columns are unconstrained free text** among the tables agents work
with; the others have a CHECK. (`activity_log.action`, `webhook_events.source`
and `dnc_list.released_reason` are free text too - their values are fixed in
code: `core/activity.ts`, `db/activity.ts`, `db/dnc.ts`.)

| Column | Written by | Status |
|---|---|---|
| `dispositions.value` | Agent, Phase 3 | The seven values are listed in `DESIGN-PROMPT.md` section 3: Interested, Callback set, No answer, Voicemail, Not interested, Wrong number, DNC. *(2026-09-23: they did not have to come from Jeel after all - the design brief already had them.)* *(2026-09-28: new rows are `closed` or `dnc` only; the seven above are retired, and old rows keep them - `core/dispositions.ts`. No migration: the column has no constraint to change.)* |
| `calls.outcome` | Twilio's end-of-call callback, Phase 4 | `answered`, `no_answer`, `busy`, `failed`, `canceled` - mapped from Twilio's statuses in `core/calls.ts` - and `missed`, for an incoming call nobody answered. Null while a call is in progress. No constraint on the column. |
| `dnc_list.reason` | Poller, webhook and the DNC outcome | Poller writes `ezt_opt_out` for a contact already opted out in EZ Texting; the webhook writes `sms_stop` for a STOP reply. An agent's DNC outcome writes `agent_disposition` (`db/dnc.ts`), since Phase 3 - `AGENT-WORKSPACE.md`. |
| `messages.delivery_status` | Send path | Whatever EZ Texting returns. Unverified - we have never read a delivery status back. *(2026-09-28: we write two values. `failed` - a send EZ Texting refused, with no `ezt_message_id`. `sending` - an automated text between its row being written and EZ Texting's id being recorded, `db/outbound.ts`; it stays `sending` only if the write after a successful send failed, and counts as sent. Everything else is NULL.)* |

Each should get a CHECK once its values are known. Until then anything is
accepted, including typos, and nothing will complain.

**`settings` values are all TEXT.** `expiry_days = 'banana'` inserts happily and
fails later at the point of use. Acceptable at this scale, but it is a deliberate
trade rather than an oversight.

**`conversations.expires_at` is set when a message is sent,** not when the
conversation is created - by `sendOpener` (`worker/opener.ts`, for the poller and the opener retry) and by `reply-flow.ts`
for every send in the flow. It is the window the lead has to reply to *that
message*, so a conversation whose opener failed has not started one. The expiry
sweep falls back to `created_at + expiry_days` for those, which is what stops
them sitting `open` forever.

**`conversations.agent_took_over_at`** records when an agent first sent a manual
SMS to the lead. From then on the state machine stores replies and flags them
but scores nothing and sends nothing: the lead is answering the agent, not us.
STATE-MACHINE.md rule 2b is the authority.

It is a timestamp rather than a boolean because the timeline has to show when
the handoff happened, and deliberately not a status - the conversation keeps the
one it had, so the queue tabs, Admin > Leads and expiry are all unaffected.
Opt-out is checked before it and is unaffected either way. Added in `003`; set by
`db/agent-sms.ts` on an agent's first text to a lead whose conversation is
still open, and read by the reply flow and the lead card.

**`conversations.completed_at`** - migration `004`, 2026-09-28 - is when the
lead's third answer arrived. `api/reply-flow.ts` stamps it the first time the
conversation is saved as `completed` and keeps it on later saves; NULL
otherwise. Admin > Overview counts "Answered all 3" by it: without it the page
could only count leads that *arrived* in a period and had completed since.

The migration fills it in for conversations already completed, from the time the
thanks message went out - sent the instant a conversation completes - falling
back to `updated_at` when the thanks failed to send. Checked on local data: all
five completed conversations took their thanks message's time exactly.

## Seeded data

The seeded message copy is the mockup's wording, page 2: the opener carries the
sender name, the reason for the text and the opt-out, and `{first_name}` is
filled in at send time. Copy that is only the reply options would reach a lead
as an unexplained menu from an unknown number, which is also what US carriers
object to in a first message.

`001_init.sql` seeds `settings`, `scoring_rules` and `tiers` with the defaults
from the mockup: Responded +10, Completed +10, Q1 5/10/15, Q2 30/20/5,
Q3 35/25/10, and HOT 75-100 / WARM 45-74 / LOW 1-44. It also seeds the question
and reply copy, the 60s poll interval (30s since migration 005) and the 5 minute poll overlap.
Migration 007 adds one more message, `message_missed_call`: the text sent after
a call to us that nobody answered.

All three tables were meant to be edited by a superadmin at runtime. They are
not: since 2026-09-23 Admin shows them and a migration changes them
(CLAUDE.md §10). The worker and the state machine still read them on every
use, so a migration takes effect without a restart.

### LOW is mostly for partial conversations

A completed conversation cannot score below 40: `responded` and `completed` add
20 between them, and the cheapest answers add another 20. Of the 27 possible
answer combinations, 13 land HOT, 13 WARM, and only one - the least engaged
answer to all three questions - lands LOW. A test in
`core/state-machine.test.ts` walks all 27 and asserts that split, so a change
to the seeded points or bands fails there rather than quietly reshaping the
queue.

That is not a mis-set band. Scoring applies to partial conversations too. A
lead who replies once and goes quiet scores 10 and is LOW; one who stalls after
Q2 sits in the low WARM range. The admin screen's own preview shows
"Responded, stalled at Q1 -> 10 LOW".

So the tiers are only skewed if you look at completions alone, and at 50-100
leads a day the drop-outs will not be rare. The implication for the state
machine is that it has to score as answers arrive, not only on completion.
