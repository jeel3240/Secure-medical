-- Two changes, both from Phase 3. They were 003 and 004 until 2026-09-28,
-- when Jeel merged them into one file. Neither had run on production (main
-- stopped at 002), which is the only case where combining migrations is
-- allowed - WORKFLOW.md, "Migrations". The file keeps the 003 name so a
-- database that already ran 003 does not try to add the column a second time.
--
-- ---------------------------------------------------------------------------
-- 1. conversations.agent_took_over_at
-- ---------------------------------------------------------------------------
--
-- When an agent took the conversation over from the automated questions.
--
-- Set the first time an agent sends a manual SMS to the lead. From then on the
-- state machine stores replies and flags them for the agent, but scores
-- nothing and sends no question or clarification: the lead is answering the
-- agent, not us, and an automated "Question 2 of 3" landing on top of that
-- conversation reads as a broken system to the person we are selling to.
-- STATE-MACHINE.md rule 2b is the authority.
--
-- A timestamp rather than a boolean, because the timeline has to show when the
-- handoff happened alongside the messages either side of it.
--
-- Deliberately not a status. The conversation keeps whatever status it had, so
-- the queue tabs and Admin > Leads are unaffected and expiry still applies -
-- the agent's callback and disposition are what track the lead from then on.
-- Opt-out is checked before this and is unaffected: a STOP after the handoff
-- still blocks the number, a START still releases it.
--
-- A new migration rather than an edit to 001, which has run against the
-- production database.
ALTER TABLE conversations ADD COLUMN agent_took_over_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2. leads.has_unread_inbound means "a person has to read this"
-- ---------------------------------------------------------------------------
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
