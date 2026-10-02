-- Who, or what, answered a call we placed - approved by leadership, 2026-10-02.
-- docs/TWILIO.md, "Voicemail".
--
-- A call that reached the lead's voicemail was saved as `answered`: to Twilio a
-- phone that picks up has answered, whoever or whatever picked up. Twilio's
-- answering machine detection listens to the first seconds and says which it
-- was. That verdict is kept here, as Twilio gave it, and a call a machine took
-- is saved with the outcome `voicemail` rather than `answered`.
--
-- NULL: an incoming call, a call from before this migration, one nobody picked
-- up, or one where detection never reported.
ALTER TABLE calls
  ADD COLUMN answered_by TEXT
    CHECK (answered_by IN ('human', 'machine', 'fax', 'unknown'));
