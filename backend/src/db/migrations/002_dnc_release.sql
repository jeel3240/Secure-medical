-- Releasing a do-not-call entry, rather than deleting it.
--
-- A lead who texts START is asking to hear from us again, and EZ Texting
-- re-subscribes them on its side. Our block has to lift too, or the two records
-- disagree and we stay silent to someone who asked us not to be.
--
-- The row is kept: the design brief keeps do-not-call entries for compliance,
-- so the history has to show the number was blocked on one date and released on
-- another. Deleting it would lose that. Only rows with released_at IS NULL
-- block a send.
--
-- Written as a new migration rather than folded into 001, which has now run
-- against the production database.
ALTER TABLE dnc_list ADD COLUMN released_at     TIMESTAMPTZ;
ALTER TABLE dnc_list ADD COLUMN released_reason TEXT;

-- The unique index on phone stays as it is: one row per number, released or
-- not, so a number that opts out again updates the row it already has.
