-- A missed call becomes a callback for the agent it rang - Jeel, 2026-10-01.
-- docs/TWILIO.md, "A missed call"; docs/AGENT-WORKSPACE.md, "Callbacks".
--
-- Until now a callback was only ever booked by a person. One the system books
-- has to be told apart: My Callbacks labels it, and it is the only kind that
-- is finished automatically - when someone calls or texts the lead back. A
-- callback an agent booked themselves ("call me Friday") is never finished
-- for them.
ALTER TABLE callbacks
  ADD COLUMN reason TEXT NOT NULL DEFAULT 'booked'
    CHECK (reason IN ('booked', 'missed_call'));

-- "Is there already an open one for this lead?" is asked on every missed call.
CREATE INDEX idx_callbacks_open_missed_call ON callbacks (lead_id)
  WHERE done_at IS NULL AND reason = 'missed_call';
