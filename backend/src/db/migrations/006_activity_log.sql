-- Nothing is lost: an activity log, a raw webhook archive, and leads that
-- cannot be deleted with their history - Jeel, 2026-10-01. docs/AUDIT.md.
--
-- The company's policy is that data is kept as proof. Three things did not
-- meet it:
--
--   1. Some actions overwrote the only record of themselves. Releasing a lead
--      cleared who held it; rescheduling a callback replaced its time;
--      re-blocking a number replaced when and why it was first blocked. After
--      the fact, nothing said Maya held a lead from 2:00 to 2:40.
--   2. Inbound webhooks were kept as what we made of them, not as received.
--   3. Deleting a lead row would have deleted its texts, calls and notes with
--      it (ON DELETE CASCADE). Nothing in the app deletes a lead, but the
--      database should refuse, not rely on that.

-- 1. The activity log --------------------------------------------------------
--
-- One row per thing that happened: who did it, what, to which lead or user,
-- when, and the details that would otherwise be overwritten. Written in the
-- same transaction as the action, so the action and its record commit together
-- or not at all.
CREATE TABLE activity_log (
  id              BIGSERIAL PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Who did it. NULL when the system did: the poller, a webhook, Twilio.
  actor_id        INTEGER REFERENCES users(id),
  -- What, as `area.verb`: lead.picked_up, callback.rescheduled, auth.signed_in.
  -- The list is ACTIVITY_ACTIONS in core/activity.ts.
  action          TEXT NOT NULL,
  -- The lead it was done to, when there is one.
  lead_id         INTEGER REFERENCES leads(id),
  -- The user it was done to: the agent whose claim was released, the account
  -- that was deactivated.
  subject_user_id INTEGER REFERENCES users(id),
  -- What would otherwise be lost: the old and new callback time, how long a
  -- lead was held, which fields of an account changed.
  detail          JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX activity_log_lead_idx ON activity_log (lead_id, at) WHERE lead_id IS NOT NULL;
CREATE INDEX activity_log_actor_idx ON activity_log (actor_id, at) WHERE actor_id IS NOT NULL;
CREATE INDEX activity_log_action_idx ON activity_log (action, at);

-- 2. The raw webhook archive -------------------------------------------------
--
-- Every request EZ Texting and Twilio send us, as it arrived, before anything
-- is decided about it - including the ones we go on to ignore. If "did they
-- really text STOP?" is ever asked, this is the answer.
CREATE TABLE webhook_events (
  id          BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'eztexting' or 'twilio'.
  source      TEXT NOT NULL,
  -- The route it arrived on, without any secret path segment.
  path        TEXT NOT NULL,
  -- JSON, not JSONB: JSONB reorders keys and drops duplicates, and this is
  -- kept as proof of what was sent, so it is stored as the text that arrived.
  payload     JSON NOT NULL
);

CREATE INDEX webhook_events_received_idx ON webhook_events (source, received_at);

-- Both tables are add-only. A row is a record of something that happened, and
-- a record that can be edited is not proof. The database refuses, whoever asks.
CREATE FUNCTION refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is add-only: rows cannot be changed or deleted', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER activity_log_add_only BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
CREATE TRIGGER webhook_events_add_only BEFORE UPDATE OR DELETE ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- 3. A lead with history cannot be deleted -----------------------------------
--
-- Each of these was ON DELETE CASCADE. Without it the default applies: the
-- delete is refused while any row still points at the lead.
ALTER TABLE conversations DROP CONSTRAINT conversations_lead_id_fkey,
  ADD CONSTRAINT conversations_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id);
ALTER TABLE messages DROP CONSTRAINT messages_lead_id_fkey,
  ADD CONSTRAINT messages_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id);
ALTER TABLE calls DROP CONSTRAINT calls_lead_id_fkey,
  ADD CONSTRAINT calls_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id);
ALTER TABLE dispositions DROP CONSTRAINT dispositions_lead_id_fkey,
  ADD CONSTRAINT dispositions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id);
ALTER TABLE notes DROP CONSTRAINT notes_lead_id_fkey,
  ADD CONSTRAINT notes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id);
ALTER TABLE callbacks DROP CONSTRAINT callbacks_lead_id_fkey,
  ADD CONSTRAINT callbacks_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id);
