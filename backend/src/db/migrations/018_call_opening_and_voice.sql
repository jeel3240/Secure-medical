-- The automated call's opening line and voice - 2026-10-18, Jeel, after
-- hearing the first real call (T12). docs/AUTO-CALLS.md, "The script" and
-- "Decided with the client".
--
-- The opening no longer says "This is an automated call.", and says the offer
-- before asking - one short yes-or-no question last:
--   "Hi, this is Seri calling from eDrugstore. Today we're offering 25% off
--    antibiotics. Are you interested in ordering?"
--
-- No shortened "not" where it carries the meaning (Jeel, 2026-10-19, on the
-- real calls of T13): Kore's "won't" sounded like "will", so the line after a
-- stop said the opposite of what it must. "won't" and "didn't" are written out:
--   "Okay, we will not call you again. Goodbye."
--   "Sorry, I did not catch that. Press 1 for yes, 2 for no, or 9 to stop
--    these calls."
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
  SET body = 'Hi, this is Seri calling from eDrugstore. Today we''re offering 25% off antibiotics. Are you interested in ordering?'
  FROM call_scripts s
  WHERE st.script_id = s.id
    AND s.key = 'antibiotics'
    AND st.key = 'q1'
    AND st.body = 'Hi, this is Seri calling from eDrugstore. This is an automated call. Are you interested in ordering antibiotics at 25% off today?';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'call script opening: expected to change 1 row, changed %', changed;
  END IF;

  UPDATE call_scripts
  SET opt_out_body = 'Okay, we will not call you again. Goodbye.'
  WHERE key = 'antibiotics' AND opt_out_body = 'Okay, we won''t call you again. Goodbye.';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'call script stop line: expected to change 1 row, changed %', changed;
  END IF;

  -- Both steps ask again in the same words.
  UPDATE call_steps st
  SET repeat_body = 'Sorry, I did not catch that. Press 1 for yes, 2 for no, or 9 to stop these calls.'
  FROM call_scripts s
  WHERE st.script_id = s.id
    AND s.key = 'antibiotics'
    AND st.repeat_body = 'Sorry, I didn''t catch that. Press 1 for yes, 2 for no, or 9 to stop these calls.';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 2 THEN
    RAISE EXCEPTION 'call script repeat line: expected to change 2 rows, changed %', changed;
  END IF;
END $$;
