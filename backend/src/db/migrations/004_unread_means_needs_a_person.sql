-- leads.has_unread_inbound now means "a person has to read this".
--
-- Until 2026-09-28 the webhook set it on every inbound message, so a lead who
-- simply answered "1" to a question was flagged exactly like one who texted
-- after the conversation ended. The queue shows the flag as Inbound reply, and
-- from the same day it also decides who is in the queue, so the old flags would
-- turn every past responder into an inbound reply. The webhook now sets it only
-- when the state machine says the reply needs a person - STATE-MACHINE.md,
-- rules 2 and 2b.
--
-- This clears the flags the old rule left behind. A lead's message is waiting
-- for a person only if nothing was sent to them after it. When something was -
-- the next question, the thanks, a clarification, or an agent's own reply -
-- their message has been answered and the flag is stale:
--
--   answered "1", got question 2        -> cleared
--   answered question 3, got the thanks -> cleared
--   texted after the conversation ended,
--   and nothing has been sent since     -> kept
--
-- Both sides are compared on created_at, which is always our own clock, rather
-- than an inbound's received_at from EZ Texting.
--
-- One case this keeps on purpose: an answer whose next question failed to
-- send has nothing after it, so its lead stays flagged and reaches a person.
-- That is the right outcome - the automated flow never answered them.
--
-- A new migration rather than an edit to 001, which has run against the
-- production database.
UPDATE leads l
SET has_unread_inbound = false,
    updated_at = now()
WHERE l.has_unread_inbound
  AND EXISTS (
    SELECT 1
    FROM messages sent
    WHERE sent.lead_id = l.id
      AND sent.direction = 'outbound'
      AND sent.created_at > (
        SELECT max(received.created_at)
        FROM messages received
        WHERE received.lead_id = l.id
          AND received.direction = 'inbound'
      )
  );
