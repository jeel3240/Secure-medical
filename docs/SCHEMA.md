# Database schema

`backend/src/db/migrations/001_init.sql` is the source of truth for exact
columns, types and constraints. This explains what the tables are for and the
parts that are not obvious from reading the SQL.

Migrations are plain numbered `.sql` files run by `backend/scripts/migrate.js`,
which records each filename in `schema_migrations` and never re-runs it. Never
edit a migration that has already run against RDS - add a new numbered file.

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

**`previous_lead_id` is unused so far.** It exists for the resold-lead case in
CLAUDE.md section 6: the same phone sold again later should become a new lead
linked back to the old one. The poller does not do this yet - it skips a phone
it already has. Implementing it means `leads.phone UNIQUE` has to go, since the
same person would legitimately appear twice.

## Seeded data

`001_init.sql` seeds `settings`, `scoring_rules` and `tiers` with the defaults
from the mockup: Responded +10, Completed +10, Q1 5/10/15, Q2 30/20/5,
Q3 35/25/10, and HOT 75-100 / WARM 45-74 / LOW 1-44. It also seeds the question
and reply copy, the 60s poll interval and the 5 minute poll overlap.

All three tables are meant to be edited by a superadmin at runtime, so treat
the seeds as starting values rather than constants.
