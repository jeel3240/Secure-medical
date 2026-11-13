-- The one-line reason Seri gives with a call back she books - Phase 7, A15,
-- docs/AI-AGENT.md section 4: "Wants to order antibiotics", for the person who
-- calls the lead back, shown on the lead's page and its timeline.
--
-- Only her bookings carry one: an agent's own callback (`booked`) and the one a
-- missed call books (`missed_call`) have none. One short line, as her action
-- checks it (`ai/actions.ts`, at most 200 characters). Written once, with the
-- callback; nothing changes it after.
ALTER TABLE callbacks
  ADD COLUMN note TEXT,
  ADD CONSTRAINT callbacks_note_is_ai CHECK (note IS NULL OR reason = 'ai_booked'),
  ADD CONSTRAINT callbacks_note_length CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 200);

-- One call back per call she booked it on: Twilio asking twice books once.
CREATE UNIQUE INDEX callbacks_one_per_ai_call ON callbacks (booked_by_call_id) WHERE booked_by_call_id IS NOT NULL;
