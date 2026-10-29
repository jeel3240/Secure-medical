-- Automated calls - T4, 2026-10-18. docs/AUTO-CALLS.md.
--
-- The server will place calls itself: a scripted call to a lead who has not
-- answered the first text, which hands a "yes" to a person. Until a person
-- takes it, such a call has no agent. Nothing places one yet - this is the
-- table being ready for it, and production's rows are unchanged by it.

-- A third direction. `outbound` stays a call an agent placed from the browser;
-- `automated` is one the server placed.
ALTER TABLE calls DROP CONSTRAINT calls_direction_check;
ALTER TABLE calls
  ADD CONSTRAINT calls_direction_check CHECK (direction IN ('outbound', 'inbound', 'automated'));

-- An agent's call always has its agent; an automated one has one only once
-- someone takes the transfer. Was `direction = 'inbound' OR ...` (007).
ALTER TABLE calls DROP CONSTRAINT calls_outbound_has_agent;
ALTER TABLE calls
  ADD CONSTRAINT calls_outbound_has_agent CHECK (direction <> 'outbound' OR agent_id IS NOT NULL);

-- How the script ended, beside `outcome`, which keeps Twilio's view of the call
-- (answered, no answer, voicemail...). Written once, when the call reaches its
-- end in the script - the code sets it only while it is empty, so a webhook
-- Twilio sends twice cannot act twice. Automated calls only.
ALTER TABLE calls
  ADD COLUMN script_result TEXT
    CHECK (script_result IN (
      'transferred',      -- a "yes", and a person took it
      'transfer_missed',  -- a "yes", and nobody took it: the busy line
      'link_sent',        -- a "yes" to the link, and the link was texted
      'not_interested',
      'opted_out',        -- "stop calling me", or 9: the number is blocked
      'no_response',      -- not understood twice, or silence
      'voicemail_left',
      'hung_up',          -- picked up, and hung up before the script ended
      'unanswered',       -- nobody picked up; or Twilio refused the lead's number
      'not_placed'        -- Twilio refused it for our account's reasons, or never
                          -- confirmed it: not the lead's call (below)
    )),
  ADD CONSTRAINT calls_script_result_automated CHECK (script_result IS NULL OR direction = 'automated');

-- One automated call per lead, ever - decided by Jeel, 2026-10-17, for now. A
-- rule the database keeps, not only the code: two workers, or the worker and a
-- person testing by hand, can never call the same lead twice. Allowing a
-- second try later is a new migration that drops this index.
--
-- A call Twilio never placed - refused for our account's reasons, or never
-- confirmed (`not_placed`) - is not the lead's call, so it leaves the index
-- once ended so, and the lead can be called when Twilio is right again
-- (2026-10-29, before release: an account problem must not use up every lead
-- the robot tries meanwhile). While being placed it is in the index like any
-- other, so two placements still cannot race.
CREATE UNIQUE INDEX calls_one_automated_per_lead ON calls (lead_id)
  WHERE direction = 'automated' AND script_result IS DISTINCT FROM 'not_placed';
