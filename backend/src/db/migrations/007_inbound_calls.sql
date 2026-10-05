-- Incoming calls - Jeel, 2026-10-01. docs/TWILIO.md, "Incoming calls".
--
-- A lead who sees a missed call from our number calls it back. Until now that
-- call went nowhere: the number had no instructions, nobody was told, nothing
-- was recorded. It now rings the lead's agent in the browser; unanswered, the
-- lead is texted that we will call back and the call is kept as missed.

-- Which way a call went. Every row so far is one an agent placed.
ALTER TABLE calls
  ADD COLUMN direction TEXT NOT NULL DEFAULT 'outbound'
  CHECK (direction IN ('outbound', 'inbound'));

-- An incoming call from a lead no agent has worked rings nobody, and is still
-- kept - as missed, with no agent. Outbound rows always have one.
ALTER TABLE calls ALTER COLUMN agent_id DROP NOT NULL;
ALTER TABLE calls
  ADD CONSTRAINT calls_outbound_has_agent CHECK (direction = 'inbound' OR agent_id IS NOT NULL);

-- The text a lead gets when their call was not answered. Copy lives in
-- settings like the rest, and is shown on Admin > Configuration. One segment,
-- and no {first_name}: a lead with no name on file would be greeted as
-- "there", which reads wrong after "your call".
INSERT INTO settings (key, value) VALUES
  ('message_missed_call', 'Secure Medical: Sorry we missed your call. Our team member is not available right now and will call you back shortly.')
ON CONFLICT (key) DO NOTHING;
