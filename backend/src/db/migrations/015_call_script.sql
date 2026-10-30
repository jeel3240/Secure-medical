-- The automated call's script, as rows - T6, 2026-10-18. docs/AUTO-CALLS.md.
--
-- What the server's call says, what each answer means and where it leads,
-- stored the way the SMS flow is (012, docs/FLOWS.md): a new script is rows
-- added by a migration, not code. Its own tables rather than the flow tables:
-- only one flow can be active, and two active would make every poll fail
-- (`startConversation`, db/flows.ts), and the SMS rules - points for replying,
-- whole-reply matching, endings the queue reads - do not fit a call.
--
--   call_scripts   one per script, with the lines every step shares
--   call_steps     what it asks
--   call_choices   each answer: its words, its reply, and where it leads
--   call_answers   what each lead said - written once, never changed
--
-- Nothing reads these yet; the call itself starts in T12.

-- 1. The guide -----------------------------------------------------------------

CREATE TABLE call_scripts (
  id                SERIAL PRIMARY KEY,
  -- Stable name for code and logs: 'antibiotics'.
  key               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  -- The voice Twilio speaks the script in.
  voice             TEXT NOT NULL,
  -- Stopping is the same on every step: any of these words, or the key 9,
  -- blocks the number and says `opt_out_body`. Matched inside what was said.
  opt_out_words     TEXT[] NOT NULL,
  opt_out_body      TEXT NOT NULL,
  -- Said, and the call ended, when a step is not understood twice.
  no_response_body  TEXT NOT NULL,
  -- Left on an answering machine, after the beep. {callback_number} is read
  -- out digit by digit: the number the lead should call back.
  voicemail_body    TEXT NOT NULL,
  -- Nobody took a "yes", and nobody is about to be free.
  busy_body         TEXT NOT NULL,
  -- Nobody took a "yes" yet, but someone is on a call: before the music, and
  -- before the lead's place in line.
  hold_body         TEXT NOT NULL,
  -- The text sent on a "yes" to the link. Its own words and link per script.
  link_text         TEXT NOT NULL,
  -- The script calls use. At most one.
  is_active         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX call_scripts_one_active ON call_scripts (is_active) WHERE is_active;

CREATE TABLE call_steps (
  id          SERIAL PRIMARY KEY,
  script_id   INTEGER NOT NULL REFERENCES call_scripts(id),
  -- 'q1', 'q2' - named like the SMS flow's questions.
  key         TEXT NOT NULL,
  -- Which step is first (the lowest), and display order. Numbered in tens, as
  -- the SMS flow is. A choice may only lead to a later step, so a script
  -- cannot loop (core/call-script.ts, T8).
  position    SMALLINT NOT NULL,
  -- What the screens call it: 'Offer'.
  heading     TEXT NOT NULL,
  -- What is said.
  body        TEXT NOT NULL,
  -- Said when the answer is not understood the first time: asks for keys,
  -- which are always understood.
  repeat_body TEXT NOT NULL,
  UNIQUE (script_id, key),
  UNIQUE (script_id, position),
  -- So a choice can be held to steps of its own script.
  UNIQUE (id, script_id)
);

CREATE TABLE call_choices (
  id           SERIAL PRIMARY KEY,
  -- The script, repeated from the step, so the step and the next step can both
  -- be required to belong to it - as flow_choices does.
  script_id    INTEGER NOT NULL REFERENCES call_scripts(id),
  step_id      INTEGER NOT NULL,
  -- The key that picks it: '1', '2'. 9 is never a choice - it is stop.
  key          TEXT NOT NULL CHECK (key ~ '^[0-8]$'),
  -- What the screens show for it: 'Yes'.
  label        TEXT NOT NULL,
  -- What may be said for it, found as whole words inside the sentence:
  -- {yes,yeah,sure}. core/answers.ts, matchSpokenChoice (T7).
  words        TEXT[] NOT NULL DEFAULT '{}',
  -- Said on this answer, before the next step or the end.
  reply_body   TEXT NOT NULL,
  -- Where it leads. NULL with an `ending`: the script is over.
  next_step_id INTEGER,
  -- How the script ends on this choice:
  --   transfer   a "yes": a person is rung
  --   send_link  the link is texted
  --   declined   not interested
  ending       TEXT CHECK (ending IN ('transfer', 'send_link', 'declined')),
  UNIQUE (step_id, key),
  FOREIGN KEY (step_id, script_id) REFERENCES call_steps (id, script_id),
  CONSTRAINT call_choices_next_in_script
    FOREIGN KEY (next_step_id, script_id) REFERENCES call_steps (id, script_id),
  -- Exactly one of the two: it goes somewhere, or it ends.
  CONSTRAINT call_choices_next_or_end CHECK ((next_step_id IS NULL) <> (ending IS NULL))
);

-- 2. The real values: what each lead said ------------------------------------
--
-- One row per answer, written once - what Twilio heard, how sure it was, the
-- keys pressed, and what it was taken to mean. Kept so a wrong reading can be
-- seen, and so the confidence threshold is set from real calls, not guessed.
CREATE TABLE call_answers (
  id           BIGSERIAL PRIMARY KEY,
  call_id      INTEGER NOT NULL REFERENCES calls(id),
  lead_id      INTEGER NOT NULL REFERENCES leads(id),
  step_id      INTEGER NOT NULL REFERENCES call_steps(id),
  -- Copied from the step, so a list of answers needs no join to show.
  step_key     TEXT NOT NULL,
  -- 1 when the step was first asked, 2 when it was asked again.
  attempt      SMALLINT NOT NULL CHECK (attempt IN (1, 2)),
  -- What Twilio heard. NULL when nothing was said.
  heard        TEXT,
  -- How sure Twilio was, 0 to 1. NULL when it sent no figure.
  confidence   NUMERIC(4, 3) CHECK (confidence BETWEEN 0 AND 1),
  -- The keys pressed. NULL when none.
  digits       TEXT,
  -- What it was taken to mean.
  result       TEXT NOT NULL CHECK (result IN ('choice', 'unclear', 'silence', 'opt_out')),
  -- The choice, with its label as it was then. Only for a choice.
  choice_key   TEXT,
  choice_label TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A choice has its key and label; nothing else has either.
  CHECK ((result = 'choice') = (choice_key IS NOT NULL) AND (choice_key IS NULL) = (choice_label IS NULL)),
  -- One answer per asking: Twilio sending the same request twice saves one row.
  UNIQUE (call_id, step_id, attempt)
);
CREATE INDEX call_answers_lead ON call_answers (lead_id);

-- A record of what someone said: add-only, like the activity log (006).
CREATE TRIGGER call_answers_add_only BEFORE UPDATE OR DELETE ON call_answers
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- 3. The client's script ------------------------------------------------------
--
-- Agreed with the client on 2026-10-13/14 and with Jeel on 2026-10-15 to 17,
-- docs/AUTO-CALLS.md "The script": a scripted call (Stage 1), no email part,
-- "This is an automated call" in place of "I'm an AI assistant", the link the
-- SMS script already sends.

WITH script AS (
  INSERT INTO call_scripts
    (key, name, voice, opt_out_words, opt_out_body, no_response_body, voicemail_body,
     busy_body, hold_body, link_text, is_active)
  VALUES (
    'antibiotics',
    'eDrugstore antibiotics',
    'Polly.Joanna-Neural',
    ARRAY['stop calling', 'stop', 'remove me', 'take me off', 'do not call', 'don''t call', 'unsubscribe'],
    'Okay, we won''t call you again. Goodbye.',
    'Thank you for your time. Have a great day.',
    'Hi, this is Seri calling from eDrugstore with a quick message - we''re offering antibiotics at 25% off right now. We''d love to connect. Please call us back at {callback_number}. Thanks, and have a great day!',
    'All our agents are busy right now. An agent will call you back shortly.',
    'All our agents are on other calls. Please stay on the line.',
    'eDrugstore: Here is your link to see our medications at discount prices: https://www.edrugstore.com/anti-ez Reply STOP to opt out.',
    true
  )
  RETURNING id
),
offer AS (
  INSERT INTO call_steps (script_id, key, position, heading, body, repeat_body)
  SELECT id, 'q1', 10, 'Offer',
         'Hi, this is Seri calling from eDrugstore. This is an automated call. Are you interested in ordering antibiotics at 25% off today?',
         'Sorry, I didn''t catch that. Press 1 for yes, 2 for no, or 9 to stop these calls.'
  FROM script
  RETURNING id, script_id
),
link AS (
  INSERT INTO call_steps (script_id, key, position, heading, body, repeat_body)
  SELECT id, 'q2', 20, 'Link',
         'Can we send you a link to see all our medication at discount prices?',
         'Sorry, I didn''t catch that. Press 1 for yes, 2 for no, or 9 to stop these calls.'
  FROM script
  RETURNING id, script_id
)
INSERT INTO call_choices (script_id, step_id, key, label, words, reply_body, next_step_id, ending)
SELECT offer.script_id, offer.id, '1', 'Yes',
       ARRAY['yes', 'yeah', 'yep', 'yup', 'sure', 'okay', 'ok', 'interested', 'of course', 'absolutely', 'definitely'],
       'Great, connecting you with a live agent now. Please hold.',
       NULL, 'transfer'
FROM offer
UNION ALL
SELECT offer.script_id, offer.id, '2', 'No',
       ARRAY['no', 'nope', 'nah', 'not interested', 'no thanks', 'no thank you', 'not really', 'not now', 'not today'],
       'No problem - I''ll just ask one more quick thing.',
       link.id, NULL
FROM offer, link
UNION ALL
SELECT link.script_id, link.id, '1', 'Yes',
       ARRAY['yes', 'yeah', 'yep', 'yup', 'sure', 'okay', 'ok', 'of course', 'absolutely', 'definitely', 'send it', 'send me', 'text me'],
       'Perfect. Check your SMS. Thanks! You''ll get the link shortly. Have a great day.',
       NULL, 'send_link'
FROM link
UNION ALL
SELECT link.script_id, link.id, '2', 'No',
       ARRAY['no', 'nope', 'nah', 'not interested', 'no thanks', 'no thank you', 'not really', 'don''t text', 'do not text', 'no text'],
       'Thank you for your time. Have a great day.',
       NULL, 'declined'
FROM link;

-- 4. When it calls - the call center's numbers, not the script's -------------
--
-- Read-only on Admin > Configuration (T24); changed by a migration, like
-- everything there. The switch itself is the AUTO_CALLS environment variable.
INSERT INTO settings (key, value) VALUES
  -- 11am-5pm, Arizona time, Monday to Friday - the client, 2026-10-13; the
  -- time zone and days Jeel's, 2026-10-17.
  ('auto_call_hours_start', '11:00'),
  ('auto_call_hours_end', '17:00'),
  ('auto_call_time_zone', 'America/Phoenix'),
  ('auto_call_days', 'mon,tue,wed,thu,fri'),
  -- Called this long after the first text went out, with no reply - Jeel, 2026-10-15.
  ('auto_call_wait_minutes', '60'),
  -- How long free agents ring for a "yes".
  ('auto_call_ring_seconds', '25'),
  -- The hold line's safety stop, for a call Twilio never reported as ended.
  ('auto_call_hold_max_minutes', '10'),
  -- Below this, what Twilio heard is not trusted: asked again, for keys.
  ('auto_call_min_confidence', '0.4')
ON CONFLICT (key) DO NOTHING;
