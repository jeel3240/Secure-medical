-- Seri, the AI agent on the automated call - Phase 7, A08, 2026-11-11.
-- docs/AI-AGENT.md, sections 4 and 9; docs/SCHEMA.md.
--
-- Where her calls, every turn of her conversations, and the call backs she
-- books are kept. Nothing writes to any of it yet: the relay (A10), her action
-- (A14) and her bookings (A15) do. It adds columns and changes checks; it
-- changes no existing row, and every row already here passes the new checks.

-- 1. Her part of a call -------------------------------------------------------
--
-- On the call's own row, as `script_result` is (014): a call Seri took is an
-- automated call like any other, and its transfer, hold line and result are
-- today's.
ALTER TABLE calls
  -- When she took the call: the relay's `setup`. Null for a script call.
  ADD COLUMN ai_started_at TIMESTAMPTZ,
  -- Which version of her knowledge files she used (ai/knowledge.ts), so what
  -- she knew on any call can be traced.
  ADD COLUMN ai_knowledge_version TEXT,
  -- How her part ended. A fallback call then gets the script's own
  -- `script_result`, so this is the only record that she failed - and what
  -- the worker counts before pausing (A17). Null while she talks, or when the
  -- lead hung up first.
  ADD COLUMN ai_ended_with TEXT
    CHECK (ai_ended_with IN (
      'transfer_to_agent',
      'book_callback',
      'send_link',
      'opt_out',
      'end_call',
      'fallback'           -- she failed: OpenAI, the socket, or the relay
    )),
  ADD CONSTRAINT calls_ai_is_automated CHECK (
    direction = 'automated' OR (ai_started_at IS NULL AND ai_knowledge_version IS NULL AND ai_ended_with IS NULL)
  ),
  -- Started and the version she started with are written together, and she
  -- ends only what she started.
  ADD CONSTRAINT calls_ai_started_with_version CHECK ((ai_started_at IS NULL) = (ai_knowledge_version IS NULL)),
  ADD CONSTRAINT calls_ai_ended_after_start CHECK (ai_ended_with IS NULL OR ai_started_at IS NOT NULL);

-- Her new result: a call back at a time the lead picked (section 4).
ALTER TABLE calls DROP CONSTRAINT calls_script_result_check;
ALTER TABLE calls
  ADD CONSTRAINT calls_script_result_check CHECK (script_result IN (
    'transferred',
    'transfer_missed',
    'link_sent',
    'not_interested',
    'opted_out',
    'no_response',
    'voicemail_left',
    'hung_up',
    'unanswered',
    'not_placed',
    'callback_booked'      -- Seri booked a call back (A15)
  ));

-- 2. Every turn of her conversation -------------------------------------------
--
-- What the lead said and what Seri answered, one row each, in order: for the
-- agent who takes the transfer or the call back (A19), and for working out
-- later how calls went. The words are kept here and never written to the logs.
CREATE TABLE call_ai_turns (
  id          BIGSERIAL PRIMARY KEY,
  call_id     INTEGER NOT NULL REFERENCES calls(id),
  -- `lead` and `seri` are the conversation; `action` is how she ended it (the
  -- action and its arguments); `system` is the relay's own note - a filler
  -- said, a fallback, the stop words heard.
  who         TEXT NOT NULL CHECK (who IN ('lead', 'seri', 'action', 'system')),
  text        TEXT NOT NULL,
  -- How long Seri took to start answering, from the lead's last word.
  latency_ms  INTEGER CHECK (latency_ms >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (latency_ms IS NULL OR who = 'seri')
);
CREATE INDEX call_ai_turns_call ON call_ai_turns (call_id, id);

-- A record of what someone said: add-only, like call_answers (015).
CREATE TRIGGER call_ai_turns_add_only BEFORE UPDATE OR DELETE ON call_ai_turns
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- 3. The call backs she books -------------------------------------------------
--
-- Section 4: owned by the lead's own agent when someone holds the lead,
-- otherwise open to everyone - no agent until someone takes it (A16). Only her
-- bookings may have no agent: an agent's own (`booked`) and the one a missed
-- call books (`missed_call`, 008) still must. Each names the call it was booked
-- on.
ALTER TABLE callbacks ALTER COLUMN agent_id DROP NOT NULL;
ALTER TABLE callbacks DROP CONSTRAINT callbacks_reason_check;
ALTER TABLE callbacks
  ADD CONSTRAINT callbacks_reason_check CHECK (reason IN ('booked', 'missed_call', 'ai_booked')),
  ADD COLUMN booked_by_call_id INTEGER REFERENCES calls(id),
  ADD CONSTRAINT callbacks_agent_unless_ai CHECK (agent_id IS NOT NULL OR reason = 'ai_booked'),
  ADD CONSTRAINT callbacks_ai_names_its_call CHECK ((reason = 'ai_booked') = (booked_by_call_id IS NOT NULL));

-- 4. The switch ---------------------------------------------------------------
--
-- Off: every call gets today's script. Changed only by the server command,
-- `npm run ai-agent -- on|off` (A01), which records each change. A laptop
-- that ran the command before this migration keeps what it wrote.
INSERT INTO settings (key, value) VALUES ('ai_agent', 'off')
ON CONFLICT (key) DO NOTHING;
