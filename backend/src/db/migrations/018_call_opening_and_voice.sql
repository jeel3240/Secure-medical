-- The automated call's opening line and voice - 2026-10-18, Jeel, after
-- hearing the first real call (T12). docs/AUTO-CALLS.md, "The script" and
-- "Decided with the client".
--
-- The opening no longer says "This is an automated call.":
--   "Hi, this is Seri calling from eDrugstore. Are you interested in ordering
--    antibiotics at 25% off today?"
--
-- The voice is Google's Chirp3-HD "Kore", US English, chosen by ear on a real
-- phone from five of Twilio's newer voices, in place of Amazon Polly's
-- "Joanna" (Neural), which sounded machine-made. Twilio lists the newer voices
-- as public beta.
--
-- Each change names the value it replaces and must change exactly one row;
-- anything else stops the migration, rather than leave the script
-- half-changed or change a script edited since.
DO $$
DECLARE
  changed integer;
BEGIN
  UPDATE call_scripts
  SET voice = 'Google.en-US-Chirp3-HD-Kore'
  WHERE key = 'antibiotics' AND voice = 'Polly.Joanna-Neural';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'call script voice: expected to change 1 row, changed %', changed;
  END IF;

  UPDATE call_steps st
  SET body = 'Hi, this is Seri calling from eDrugstore. Are you interested in ordering antibiotics at 25% off today?'
  FROM call_scripts s
  WHERE st.script_id = s.id
    AND s.key = 'antibiotics'
    AND st.key = 'q1'
    AND st.body = 'Hi, this is Seri calling from eDrugstore. This is an automated call. Are you interested in ordering antibiotics at 25% off today?';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'call script opening: expected to change 1 row, changed %', changed;
  END IF;
END $$;
