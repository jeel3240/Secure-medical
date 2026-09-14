# Database schema

`backend/src/db/migrations/001_init.sql` is the source of truth for exact
columns, types and constraints. This explains what the tables are for and the
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
| `users` | Agents and superadmins. bcrypt hash, role, active flag. |
| `leads` | One person, pulled from EZ Texting. |
| `conversations` | The 3-question SMS flow for a lead, plus its score and tier. |
| `messages` | Every SMS in or out. |
| `calls` | Twilio calls, with duration and outcome. |
| `dispositions` | What an agent decided after contact. |
| `notes` | Free text an agent wrote about a lead. |
| `callbacks` | Scheduled follow-ups. |
| `dnc_list` | Phones that must never be contacted. |
| `settings` | Key/value config, admin-editable. |
| `scoring_rules` | Points per answer, admin-editable. |
| `tiers` | HOT/WARM/LOW score bands, admin-editable. |

Everything hangs off `leads.id` with `ON DELETE CASCADE`, so deleting a lead
removes its whole history.

## Things worth knowing

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
column comes out in the migration that implements this. See POLLER.md for the
per-contact decision table and what it is blocked on.

It is deliberately still here rather than removed now: the design depends on
whether a re-delivered phone reaches EZ Texting as a new contact or an update
to the existing one, and that is unconfirmed. Removing the column early would
mean re-adding it if the answer changes the shape.

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

**Leads are claimed and released explicitly.** An agent claims a lead, which
sets `assigned_to` and `assigned_at`. Everyone else sees it as in progress. The
agent releases it by clearing both, and it returns to the queue. A superadmin
can clear anyone's claim.

Claims never expire. With ten agents who know each other, a timer risks taking
a lead off someone who stepped away, and manual reassignment is enough.
`assigned_at` is still needed so a superadmin can tell a lead claimed two
minutes ago from one held since last week - without it both look identical.

A released lead carries no marker. Context comes from the timeline, which
already shows calls, messages, notes and dispositions for the lead. A lead that
is genuinely bad should get a disposition rather than being released.

**Four columns are unconstrained free text.** Every other categorical column has
a CHECK; these do not, because their permitted values are not settled yet:

| Column | Written by | Status |
|---|---|---|
| `dispositions.value` | Agent, Week 3 | Defined on mockup p.6. The PDF is images, so the list has to come from Jeel or a visual read. |
| `calls.outcome` | Twilio callback, Week 4 | Depends on Twilio's own status values. |
| `dnc_list.reason` | Poller and webhook | Poller writes `ezt_opt_out`; a STOP reply will need its own value. |
| `messages.delivery_status` | Send path | Whatever EZ Texting returns. Unverified - we have never read a delivery status back. |

Each should get a CHECK once its values are known. Until then anything is
accepted, including typos, and nothing will complain.

**`settings` values are all TEXT.** `expiry_days = 'banana'` inserts happily and
fails later at the point of use. Acceptable at this scale, but it is a deliberate
trade rather than an oversight.

**`conversations.expires_at` is never populated.** The poller creates the
conversation without it, so nothing can auto-expire. It should be
`now + expiry_days` from `settings` at creation - Phase 2, with the state
machine.

## Seeded data

`001_init.sql` seeds `settings`, `scoring_rules` and `tiers` with the defaults
from the mockup: Responded +10, Completed +10, Q1 5/10/15, Q2 30/20/5,
Q3 35/25/10, and HOT 75-100 / WARM 45-74 / LOW 1-44. It also seeds the question
and reply copy, the 60s poll interval and the 5 minute poll overlap.

All three tables are meant to be edited by a superadmin at runtime, so treat
the seeds as starting values rather than constants.

### LOW is mostly for partial conversations

A completed conversation cannot score below 40: `responded` and `completed` add
20 between them, and the cheapest answers add another 20. Of the 27 possible
answer combinations, 13 land HOT, 13 WARM, and only one - the least engaged
answer to all three questions - lands LOW.

That is not a mis-set band. Scoring applies to partial conversations too. A
lead who replies once and goes quiet scores 10 and is LOW; one who stalls after
Q2 sits in the low WARM range. The admin screen's own preview shows
"Responded, stalled at Q1 -> 10 LOW".

So the tiers are only skewed if you look at completions alone, and at 50-100
leads a day the drop-outs will not be rare. The implication for the state
machine is that it has to score as answers arrive, not only on completion.
