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
