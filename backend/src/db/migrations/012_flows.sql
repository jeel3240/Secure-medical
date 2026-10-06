-- Flows: questions and answers as rows - Jeel, 2026-10-05. docs/FLOWS.md.
--
-- The SMS flow was one fixed script: three questions, three choices each,
-- answers in conversations.q1..q3, copy in `settings`, points in
-- `scoring_rules`. The client has replaced that script (eDrugstore
-- antibiotics: two-choice questions, a reply per answer, a branch after "No")
-- and more groups are coming, each with its own questions and its own number
-- of them. None of that fits three columns.
--
-- A flow is now rows in shared tables. Adding one is adding rows - not a
-- table, not a column, not code:
--
--   flows                 one per script
--   flow_questions        what it asks
--   flow_choices          each question's choices: the reply, the points, and
--                         where the lead goes next
--   conversation_answers  what each lead answered - the real values
--
-- Done now, before the first real lead, because afterwards every change to
-- this would have to carry live data with it.

-- 1. The guide: flows, their questions, their choices ------------------------

CREATE TABLE flows (
  id               SERIAL PRIMARY KEY,
  -- Stable name for code and logs: 'antibiotics'.
  key              TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  -- The EZ Texting group whose leads get this flow. Not read yet: with one
  -- active flow every new lead gets it. It is here for the second group.
  ezt_group        TEXT,
  -- Awarded once, on the first reply of any kind. No default, and never 0:
  -- "has replied" is read everywhere as "score above 0" (the queue, the lead
  -- card), so a flow that awarded nothing for replying would hide its leads.
  responded_points INTEGER NOT NULL CHECK (responded_points > 0),
  -- Awarded when the flow ends by a choice whose ending is 'completed'.
  completed_points INTEGER NOT NULL DEFAULT 0,
  -- Sent after a second unclear reply, when a person takes over.
  review_body      TEXT NOT NULL,
  -- The flow new leads are given. At most one.
  is_active        BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX flows_one_active ON flows (is_active) WHERE is_active;

CREATE TABLE flow_questions (
  id           SERIAL PRIMARY KEY,
  flow_id      INTEGER NOT NULL REFERENCES flows(id),
  -- 'q1', 'q2' for the main line; 'q1-a', 'q1-b' for a sub-question, asked
  -- after question 1. The screens name a question from it: "Q2", "Q1-a".
  key          TEXT NOT NULL,
  -- Display order, and which question is first (the lowest). It does not say
  -- where a lead goes next - each choice does - but a choice may only lead
  -- to a later position, so a flow cannot loop (core/state-machine.ts).
  -- Numbered in tens - 10, 20, 30 - so a sub-question fits behind its parent
  -- (11, 12) without renumbering the questions after it.
  position     SMALLINT NOT NULL,
  -- The question as the lead reads it. May contain {first_name}.
  body         TEXT NOT NULL,
  -- Sent when the reply is not one of the choices: repeats the options.
  clarify_body TEXT NOT NULL,
  -- What the screens call this answer: 'Next step'.
  heading      TEXT NOT NULL,
  UNIQUE (flow_id, key),
  UNIQUE (flow_id, position),
  -- So a choice and a conversation can be held to questions of their own flow.
  UNIQUE (id, flow_id)
);

CREATE TABLE flow_choices (
  id               SERIAL PRIMARY KEY,
  -- The flow, repeated from the question, so that both the question and the
  -- next question can be required to belong to it. Without it a choice could
  -- point into another flow, and the lead would be sent a question that is
  -- not theirs.
  flow_id          INTEGER NOT NULL REFERENCES flows(id),
  question_id      INTEGER NOT NULL,
  -- What the lead types: '1', '2', '3'.
  choice           TEXT NOT NULL,
  -- What the screens show for it: 'Talk to an agent'.
  label            TEXT NOT NULL,
  -- Also accepted, as the whole reply, any case: {yes,y,yeah}.
  words            TEXT[] NOT NULL DEFAULT '{}',
  points           INTEGER NOT NULL DEFAULT 0,
  -- Sent on this answer, in front of the next question if there is one.
  reply_body       TEXT,
  -- Where the lead goes next. NULL with an `ending`: the flow is over.
  next_question_id INTEGER,
  -- How the flow ends on this choice:
  --   completed      the questions are answered; agents call, by score
  --   offers         wants offers only; not for agents
  --   wants_contact  asked to hear from a rep; agents call
  --   declined       wants neither; not for agents
  ending           TEXT CHECK (ending IN ('completed', 'offers', 'wants_contact', 'declined')),
  UNIQUE (question_id, choice),
  FOREIGN KEY (question_id, flow_id) REFERENCES flow_questions (id, flow_id),
  CONSTRAINT flow_choices_next_in_flow
    FOREIGN KEY (next_question_id, flow_id) REFERENCES flow_questions (id, flow_id),
  -- Exactly one of the two: it goes somewhere, or it ends.
  CONSTRAINT flow_choices_next_or_end CHECK ((next_question_id IS NULL) <> (ending IS NULL))
);

-- 2. The real values: what each lead answered --------------------------------
--
-- One row per answer, written once. The label and the points are copied in as
-- they were at that moment, so changing a flow later never rewrites what an
-- earlier lead chose or earned (the reason for 009_answer_labels, now for
-- points too).
CREATE TABLE conversation_answers (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  lead_id         INTEGER NOT NULL REFERENCES leads(id),
  question_id     INTEGER NOT NULL REFERENCES flow_questions(id),
  -- Copied from the question, so a list of answers needs no join to show.
  question_key    TEXT NOT NULL,
  position        SMALLINT NOT NULL,
  heading         TEXT NOT NULL,
  choice          TEXT NOT NULL,
  label           TEXT NOT NULL,
  points          INTEGER NOT NULL DEFAULT 0,
  -- The text this answer was read from, so the thread can show "1 - Yes" on
  -- the very message that said it, with no guessing. NULL only for an answer
  -- copied in below from the old columns, which never recorded it.
  message_id      INTEGER REFERENCES messages(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A question is answered once in a conversation.
  UNIQUE (conversation_id, question_id)
);
CREATE INDEX conversation_answers_lead ON conversation_answers (lead_id);

-- A record of what someone said: add-only, like the activity log (006).
CREATE TRIGGER conversation_answers_add_only BEFORE UPDATE OR DELETE ON conversation_answers
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- 3. Where a lead is: conversations ------------------------------------------

ALTER TABLE conversations
  ADD COLUMN flow_id             INTEGER REFERENCES flows(id),
  -- The question the lead is on - or, once it has expired or gone to review,
  -- the one they stopped at. NULL once the questions are finished, and for a
  -- suppressed conversation, which was never asked one.
  ADD COLUMN current_question_id INTEGER,
  -- How the flow ended - the choice's `ending`. NULL while open, and for one
  -- that expired, was suppressed or went to review.
  ADD COLUMN end_outcome         TEXT CHECK (end_outcome IN ('completed', 'offers', 'wants_contact', 'declined'));

-- A conversation is only ever on a question of its own flow.
ALTER TABLE conversations
  ADD CONSTRAINT conversations_question_in_flow
    FOREIGN KEY (current_question_id, flow_id) REFERENCES flow_questions (id, flow_id);

-- `step` stays as the current question's position, for screens that say "On
-- Q2". A flow may have more than three.
ALTER TABLE conversations DROP CONSTRAINT conversations_step_check;

-- 4. The flow that existed until today, as rows -------------------------------
--
-- Health & wellness: three questions, three choices. Kept, inactive, built
-- from the copy and points that were live, so every conversation already in
-- the database belongs to a flow and its answers are carried over.
INSERT INTO flows (key, name, responded_points, completed_points, review_body, is_active)
SELECT 'wellness', 'Health & wellness (retired 2026-10-05)',
       (SELECT points FROM scoring_rules WHERE code = 'responded'),
       (SELECT points FROM scoring_rules WHERE code = 'completed'),
       (SELECT value FROM settings WHERE key = 'message_review'),
       false;

INSERT INTO flow_questions (flow_id, key, position, body, clarify_body, heading)
SELECT f.id, 'q' || n, n,
       (SELECT value FROM settings WHERE key = 'question_' || n),
       (SELECT value FROM settings WHERE key = 'message_clarify_' || n),
       (ARRAY['Interest', 'Timing', 'Prefers'])[n]
FROM flows f, generate_series(1, 3) AS n
WHERE f.key = 'wellness';

INSERT INTO flow_choices (flow_id, question_id, choice, label, points, reply_body, next_question_id, ending)
SELECT q.flow_id, q.id, r.choice, regexp_replace(r.label, '^Q[123]:\s*', ''), r.points,
       CASE WHEN q.position = 3 THEN (SELECT value FROM settings WHERE key = 'message_thanks') END,
       nq.id,
       CASE WHEN q.position = 3 THEN 'completed' END
FROM flow_questions q
JOIN flows f ON f.id = q.flow_id AND f.key = 'wellness'
JOIN scoring_rules r ON r.question = q.position AND r.choice IS NOT NULL
LEFT JOIN flow_questions nq ON nq.flow_id = q.flow_id AND nq.position = q.position + 1;

-- The words the old flow accepted (core/answers.ts, until today).
UPDATE flow_choices c SET words = w.words
FROM flow_questions q, flows f,
     (VALUES (1, '1', ARRAY['supplements', 'supplement']), (1, '2', ARRAY['telehealth', 'rx']), (1, '3', ARRAY['both']),
             (2, '1', ARRAY['today']), (2, '2', ARRAY['this week', 'week']), (2, '3', ARRAY['researching']),
             (3, '1', ARRAY['call', 'call me']), (3, '2', ARRAY['text', 'text me']), (3, '3', ARRAY['later'])
     ) AS w(position, choice, words)
WHERE c.question_id = q.id AND q.flow_id = f.id AND f.key = 'wellness'
  AND q.position = w.position AND c.choice = w.choice;

UPDATE conversations c SET
  flow_id = f.id,
  -- Where the lead is, or stopped: `step` was kept on an expired or review one.
  current_question_id = CASE WHEN c.status IN ('open', 'expired', 'review')
    THEN (SELECT q.id FROM flow_questions q WHERE q.flow_id = f.id AND q.position = COALESCE(c.step, 1)) END,
  end_outcome = CASE WHEN c.status = 'completed' THEN 'completed' END
FROM flows f WHERE f.key = 'wellness';

-- Every answer already given, into the new table. q1..q3 and their labels
-- stay where they are, no longer read.
--
-- `created_at` here is when the conversation was last saved, not when each
-- answer was given: the old columns never recorded that. Only rows copied by
-- this migration are affected - docs/SCHEMA.md.
INSERT INTO conversation_answers (conversation_id, lead_id, question_id, question_key, position, heading, choice, label, points, created_at)
SELECT c.id, c.lead_id, q.id, q.key, q.position, q.heading, a.choice,
       COALESCE(a.label, ch.label, a.choice), COALESCE(ch.points, 0), c.updated_at
FROM conversations c
CROSS JOIN LATERAL (VALUES (1, c.q1, c.q1_label), (2, c.q2, c.q2_label), (3, c.q3, c.q3_label)) AS a(position, choice, label)
JOIN flow_questions q ON q.flow_id = c.flow_id AND q.position = a.position
LEFT JOIN flow_choices ch ON ch.question_id = q.id AND ch.choice = a.choice
WHERE a.choice IS NOT NULL;

-- 5. The flow new leads get: eDrugstore antibiotics ---------------------------
--
-- The client's script and points, confirmed by email 2026-10-05.
-- docs/STATE-MACHINE.md has the flow as the lead meets it.
INSERT INTO flows (key, name, responded_points, completed_points, review_body, is_active) VALUES
  ('antibiotics', 'eDrugstore antibiotics', 10, 10,
   'Thanks! An eDrugstore representative will follow up with you directly.', true);

INSERT INTO flow_questions (flow_id, key, position, body, clarify_body, heading)
SELECT f.id, q.key, q.position, q.body, q.clarify_body, q.heading
FROM flows f, (VALUES
  ('q1', 10,
   'eDrugstore: Hi {first_name}, did you recently request more info about ordering antibiotics online? Reply 1. Yes, 2. No. Reply STOP to opt out.',
   'Sorry, please reply 1 for Yes or 2 for No.',
   'Requested info'),
  ('q2', 20,
   'Have you used telemedicine to get prescription medication before? Reply 1. Yes, 2. No.',
   'Sorry, please reply 1 for Yes or 2 for No.',
   'Used telemedicine'),
  ('q3', 30,
   'Ready to move forward? Reply 1. I know which antibiotic I need, 2. Talk to an agent for options & discounts, 3. Order online.',
   'Sorry, please reply 1. I know which antibiotic I need, 2. Talk to an agent, or 3. Order online.',
   'Next step'),
  -- A sub-question of q1: asked only of a lead who said No to it.
  ('q1-a', 11,
   'Would you like to receive special offers from eDrugstore? Reply 1. Yes for offers, 2. Learn more from a rep, 3. No thanks, or STOP to unsubscribe.',
   'Sorry, please reply 1 for offers, 2 to learn more from a rep, 3 for no thanks, or STOP to unsubscribe.',
   'Offers')
) AS q(key, position, body, clarify_body, heading)
WHERE f.key = 'antibiotics';

INSERT INTO flow_choices (flow_id, question_id, choice, label, words, points, reply_body, next_question_id, ending)
SELECT f.id, q.id, c.choice, c.label, c.words, c.points, c.reply_body, nq.id, c.ending
FROM flows f
JOIN (VALUES
  ('q1', '1', 'Yes', ARRAY['yes', 'y', 'yeah', 'yep', 'yup', 'yes please', 'sure', 'ok', 'okay', 'correct'], 20,
   'Great! Let''s get you started.', 'q2', NULL),
  ('q1', '2', 'No', ARRAY['no', 'n', 'nope', 'nah', 'no thanks', 'no thank you'], 0,
   'No problem.', 'q1-a', NULL),
  ('q2', '1', 'Yes', ARRAY['yes', 'y', 'yeah', 'yep', 'yup', 'yes please', 'i have'], 15,
   'Great. eDrugstore makes the online consultation process simple.', 'q3', NULL),
  ('q2', '2', 'No', ARRAY['no', 'n', 'nope', 'nah', 'never', 'not yet'], 5,
   'No problem. You can complete your information online and, when required, consult with a licensed healthcare provider.', 'q3', NULL),
  ('q3', '1', 'I know which antibiotic', ARRAY['i know', 'know', 'i know which one'], 30,
   'Great. Start your online consultation here: https://www.edrugstore.com/anti-ez', NULL, 'completed'),
  ('q3', '2', 'Talk to an agent', ARRAY['agent', 'talk', 'call', 'call me', 'talk to an agent'], 45,
   'Thanks! An eDrugstore representative will contact you to discuss available options, pricing and discounts.', NULL, 'completed'),
  ('q3', '3', 'Order online', ARRAY['online', 'order', 'order online'], 10,
   'Great! Start your online order and consultation here: https://www.edrugstore.com/anti-ez', NULL, 'completed'),
  ('q1-a', '1', 'Special offers', ARRAY['yes', 'y', 'yes please', 'offers', 'offer'], 0,
   'Thanks! You''ll receive special offers from eDrugstore. Reply STOP to opt out.', NULL, 'offers'),
  ('q1-a', '2', 'Learn more', ARRAY['learn more', 'learn', 'more', 'learnmore'], 0,
   'Thanks! An eDrugstore representative will contact you shortly.', NULL, 'wants_contact'),
  -- Jeel, 2026-10-06: a lead who wants neither had no way to say so but STOP,
  -- which takes them off every list. Typed anyway, "no" was an unclear reply -
  -- and a second one promised them a rep and put them in the agents' queue.
  ('q1-a', '3', 'No thanks', ARRAY['no', 'n', 'nope', 'nah', 'no thanks', 'no thank you', 'not interested'], 0,
   'No problem. Thanks for your time.', NULL, 'declined')
) AS c(question, choice, label, words, points, reply_body, next_key, ending) ON true
JOIN flow_questions q ON q.flow_id = f.id AND q.key = c.question
LEFT JOIN flow_questions nq ON nq.flow_id = f.id AND nq.key = c.next_key
WHERE f.key = 'antibiotics';

-- Outside the flow, the same brand: the text after a call nobody answered.
UPDATE settings SET value = 'eDrugstore: Sorry we missed your call. A team member will call you back shortly.', updated_at = now()
WHERE key = 'message_missed_call';
