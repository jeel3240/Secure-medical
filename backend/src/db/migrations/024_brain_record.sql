-- The new brain's record of each call - Phase 7, A31, docs/AI-AGENT.md
-- section 12. At each reply of Seri's the brain keeps, as one `system` turn:
-- the policy's version, what the lead was understood to have done (acts), what
-- it decided (moves), the call's record before and after - so "why did she
-- say that?" is answered from the database, and a call whose line dropped
-- picks up from where it was.
--
-- Only on the relay's own notes (`system`): a turn of the lead's or hers
-- carries words, never a record. Add-only, like every turn (022's trigger).
ALTER TABLE call_ai_turns
  ADD COLUMN data JSONB,
  ADD CONSTRAINT call_ai_turns_data_on_system CHECK (data IS NULL OR who = 'system');
