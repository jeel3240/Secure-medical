-- email is stored lowercased, so sign-in is case-insensitive.
--
-- session_version is copied into every session token at sign-in, and the API
-- rejects a token whose version no longer matches. Bumping it ends every
-- existing session for the user at once: on deactivation, admin password
-- reset, password change and sign-out. Without it a token stays valid until
-- it expires, 12 hours later. See docs/AUTH.md.
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  name                 TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('superadmin', 'agent')),
  is_active            BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  session_version      INTEGER NOT NULL DEFAULT 0,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- phone is E.164 and the only stable identity EZ Texting gives us: the
-- contacts API returns no per-contact id, so dedupe happens on phone.
CREATE TABLE leads (
  id                 SERIAL PRIMARY KEY,
  phone              TEXT NOT NULL UNIQUE,
  first_name         TEXT,
  last_name          TEXT,
  email              TEXT,
  source             TEXT,
  group_id           TEXT,
  group_name         TEXT,
  ezt_added_at       TIMESTAMPTZ,
  previous_lead_id   INTEGER REFERENCES leads(id),
  -- Claim/release: an agent claims a lead, and releases it when they are done
  -- with it. Claims do not expire - assigned_at is what lets a superadmin see
  -- a lead has been held too long and force-release it.
  assigned_to        INTEGER REFERENCES users(id),
  assigned_at        TIMESTAMPTZ,
  has_unread_inbound BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id            SERIAL PRIMARY KEY,
  lead_id       INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('open', 'completed', 'expired', 'suppressed', 'review')),
  step          SMALLINT CHECK (step BETWEEN 1 AND 3),
  q1            TEXT,
  q2            TEXT,
  q3            TEXT,
  invalid_count SMALLINT NOT NULL DEFAULT 0,
  score         INTEGER NOT NULL DEFAULT 0,
  tier          TEXT CHECK (tier IN ('HOT', 'WARM', 'LOW')),
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Only one open conversation per phone number, ever." Enforced against
-- lead_id because leads.phone is itself unique.
CREATE UNIQUE INDEX one_open_conversation_per_lead
  ON conversations (lead_id) WHERE status = 'open';

-- Outbound and inbound are keyed differently, because the webhook's "id" is not
-- an id for the reply: it is the id of OUR message the lead replied to. Two
-- replies to the same question arrive carrying the same value, so it cannot be
-- unique across inbound rows. See docs/EZTEXTING-API.md.
CREATE TABLE messages (
  id                SERIAL PRIMARY KEY,
  lead_id           INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  direction         TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body              TEXT NOT NULL,
  -- Outbound only: the id returned by POST /messages.
  ezt_message_id    TEXT,
  -- Inbound only: which of our messages this is a reply to. Not unique - a
  -- lead may reply more than once to the same question.
  in_reply_to_ezt_id TEXT,
  -- Inbound only: dedupe key. EZ Texting retries webhooks, and the same phone
  -- cannot send two texts in the same millisecond.
  from_number       TEXT,
  received_at       TIMESTAMPTZ,
  sent_by           INTEGER REFERENCES users(id),
  delivery_status   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX messages_ezt_message_id_outbound
  ON messages (ezt_message_id) WHERE direction = 'outbound';

CREATE UNIQUE INDEX messages_inbound_dedupe
  ON messages (from_number, received_at) WHERE direction = 'inbound';

CREATE TABLE calls (
  id              SERIAL PRIMARY KEY,
  lead_id         INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  agent_id        INTEGER NOT NULL REFERENCES users(id),
  twilio_call_sid TEXT UNIQUE,
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  duration_sec    INTEGER,
  outcome         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dispositions (
  id         SERIAL PRIMARY KEY,
  lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  agent_id   INTEGER NOT NULL REFERENCES users(id),
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notes (
  id         SERIAL PRIMARY KEY,
  lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  agent_id   INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE callbacks (
  id           SERIAL PRIMARY KEY,
  lead_id      INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  agent_id     INTEGER NOT NULL REFERENCES users(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  done_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dnc_list (
  id       SERIAL PRIMARY KEY,
  phone    TEXT NOT NULL UNIQUE,
  reason   TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin-editable scoring. question 0 = flat awards (responded/completed);
-- questions 1-3 = points per answer choice.
CREATE TABLE scoring_rules (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  question   SMALLINT NOT NULL,
  choice     TEXT,
  points     INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tiers (
  name       TEXT PRIMARY KEY,
  min_score  INTEGER NOT NULL,
  max_score  INTEGER NOT NULL,
  sort_order SMALLINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_assigned_to ON leads (assigned_to);
CREATE INDEX idx_leads_created_at ON leads (created_at DESC);
CREATE INDEX idx_conversations_status ON conversations (status);
CREATE INDEX idx_conversations_lead_id ON conversations (lead_id);
CREATE INDEX idx_messages_lead_id ON messages (lead_id, created_at DESC);
CREATE INDEX idx_calls_lead_id ON calls (lead_id);
CREATE INDEX idx_dispositions_lead_id ON dispositions (lead_id);
CREATE INDEX idx_notes_lead_id ON notes (lead_id);
CREATE INDEX idx_callbacks_agent_id ON callbacks (agent_id, scheduled_at);

INSERT INTO settings (key, value) VALUES
  ('poll_interval_seconds', '60'),
  ('poll_overlap_minutes', '5'),
  ('expiry_days', '7'),
  ('max_invalid_before_review', '1'),
  -- Copy from the mockup, page 2, with the options numbered "1." rather than
  -- "1" - Jeel, 2026-09-22 - because the dot separates the number from the word
  -- at a glance. The word "options" came out of the opener to pay for the three
  -- extra characters: without that, a name of six letters or more would push the
  -- text past one 160-character segment and lose the name. The opener carries
  -- the sender name, the reason for the text and the opt-out, which is what US
  -- carriers expect in a first message. {first_name} is filled in at send time.
  ('question_1', 'Secure Medical: Hi {first_name}, you asked about health & wellness. What interests you? Reply 1. Supplements, 2. Telehealth/Rx, 3. Both. Reply STOP to opt out.'),
  ('question_2', 'Great. When are you looking for help? Reply 1. Today, 2. This week, 3. Just researching.'),
  ('question_3', 'How would you like us to help? Reply 1. Call me now, 2. Text me, 3. Contact me later.'),
  -- One clarification per question, repeating that question's options, so a
  -- confused lead is reminded what 1, 2 and 3 mean. Wording approved by Jeel
  -- 2026-09-19. Sent for an unclear reply to question N.
  ('message_clarify_1', 'Sorry, please reply with just a number: 1. Supplements, 2. Telehealth/Rx, or 3. Both.'),
  ('message_clarify_2', 'Sorry, please reply with just a number: 1. Today, 2. This week, or 3. Just researching.'),
  ('message_clarify_3', 'Sorry, please reply with just a number: 1. Call me now, 2. Text me, or 3. Contact me later.'),
  ('message_stop', 'You have been unsubscribed and will not receive further messages from Secure Medical.'),
  ('message_thanks', 'Thanks! A team member will reach out shortly.'),
  ('message_review', 'Thanks! A team member will follow up with you directly.');

INSERT INTO scoring_rules (code, label, question, choice, points) VALUES
  ('responded',  'Responded at all',              0, NULL, 10),
  ('completed',  'Completed all questions',       0, NULL, 10),
  ('q1_1',       'Q1: Supplements',               1, '1',   5),
  ('q1_2',       'Q1: Telehealth/Rx',             1, '2',  10),
  ('q1_3',       'Q1: Both',                      1, '3',  15),
  ('q2_1',       'Q2: Today',                     2, '1',  30),
  ('q2_2',       'Q2: This week',                 2, '2',  20),
  ('q2_3',       'Q2: Just researching',          2, '3',   5),
  ('q3_1',       'Q3: Call me now',               3, '1',  35),
  ('q3_2',       'Q3: Text me',                   3, '2',  25),
  ('q3_3',       'Q3: Contact me later',          3, '3',  10);

INSERT INTO tiers (name, min_score, max_score, sort_order) VALUES
  ('HOT',  75, 100, 1),
  ('WARM', 45,  74, 2),
  ('LOW',   1,  44, 3);
