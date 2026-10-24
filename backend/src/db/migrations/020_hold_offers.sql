-- A lead on hold offered to whoever comes free - T17, 2026-10-22.
-- docs/AUTO-CALLS.md, "The hold line".
--
-- When someone who takes transfers becomes free, the lead who has waited
-- longest on hold rings them alone. Each such ring is one row: who was rung,
-- when, and how it ended - taken, declined, rung out (`missed`), the ring
-- never completing (`failed`: Twilio's own `failed` or `canceled`, or cut
-- short by the voicemail message - T18), the lead
-- hanging up, never heard of again (`expired`), or never rung - Twilio not
-- taking the redirect, or the call not ours to ring (`unsent`). A row is written once and ended once, never removed:
-- it is also how the same lead is never offered twice to the same person.
--
-- One offer at a time per lead, and per person: a lead rings one person, a
-- person is rung with one lead - two triggers at once cannot both offer.
CREATE TABLE call_offers (
  id         SERIAL PRIMARY KEY,
  call_id    INTEGER NOT NULL REFERENCES calls(id),
  agent_id   INTEGER NOT NULL REFERENCES users(id),
  offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ,
  outcome    TEXT CHECK (outcome IN ('taken', 'declined', 'missed', 'failed', 'hung_up', 'expired', 'unsent')),
  CONSTRAINT call_offers_ended_with_outcome CHECK ((ended_at IS NULL) = (outcome IS NULL))
);

CREATE UNIQUE INDEX call_offers_one_live_per_call ON call_offers (call_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX call_offers_one_live_per_agent ON call_offers (agent_id) WHERE ended_at IS NULL;
CREATE INDEX call_offers_by_call ON call_offers (call_id, agent_id);

-- An offer is ended once: its end and outcome are never changed after.
CREATE FUNCTION call_offers_end_once() RETURNS trigger AS $$
BEGIN
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'call_offers: an ended offer cannot be changed';
  END IF;
  IF NEW.call_id <> OLD.call_id OR NEW.agent_id <> OLD.agent_id OR NEW.offered_at <> OLD.offered_at THEN
    RAISE EXCEPTION 'call_offers: only an offer''s end can be written';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER call_offers_end_once BEFORE UPDATE ON call_offers
  FOR EACH ROW EXECUTE FUNCTION call_offers_end_once();

CREATE FUNCTION call_offers_never_deleted() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'call_offers: rows cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER call_offers_never_deleted BEFORE DELETE ON call_offers
  FOR EACH ROW EXECUTE FUNCTION call_offers_never_deleted();

-- How long a lead on hold rings the person who came free (T17) - a setting,
-- like the transfer's own ring time; read on every offer.
INSERT INTO settings (key, value) VALUES ('auto_call_offer_ring_seconds', '20')
ON CONFLICT (key) DO NOTHING;

-- Who has just finished a call (`db/presence.ts`, JUST_OFF_A_CALL_SQL): a
-- lead on hold waits for someone writing the note of a call that ended in the
-- last two minutes. Asked on every hold decision and every look at the hold.
CREATE INDEX calls_ended_by_agent ON calls (agent_id, ended_at) WHERE agent_id IS NOT NULL;
