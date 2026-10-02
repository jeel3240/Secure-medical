-- Call recordings and their transcripts - the client asked for transcripts,
-- 2026-10-02. docs/TWILIO.md, "Recordings and transcripts".
--
-- Twilio records each call in two channels - the agent on one, the lead on the
-- other - and its transcription service turns the recording into text. The
-- audio stays at Twilio; we keep its id. The text is kept here, so it reads on
-- the lead's timeline without asking Twilio every time.
--
-- Both tables are written once and then only moved forward: a recording row
-- never changes; a transcript row goes pending -> queued -> completed or
-- failed, and its text, once there, is never rewritten.

CREATE TABLE call_recordings (
  id             SERIAL PRIMARY KEY,
  call_id        INTEGER NOT NULL REFERENCES calls(id),
  -- Twilio's id for the recording, RE... Unique: Twilio retries the callback.
  recording_sid  TEXT NOT NULL UNIQUE,
  duration_sec   INTEGER NOT NULL DEFAULT 0,
  channels       INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_call_recordings_call ON call_recordings (call_id);

CREATE TABLE call_transcripts (
  id              SERIAL PRIMARY KEY,
  call_id         INTEGER NOT NULL REFERENCES calls(id),
  recording_id    INTEGER NOT NULL UNIQUE REFERENCES call_recordings(id),
  -- pending: asked of the worker. queued: Twilio has it. completed / failed.
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'queued', 'completed', 'failed')),
  -- Twilio's id for the transcript, GT... Set once Twilio has accepted it.
  transcript_sid  TEXT UNIQUE,
  -- [{ "speaker": "agent" | "lead", "text": "...", "startSec": 1.2 }], in order.
  sentences       JSONB,
  attempts        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX idx_call_transcripts_call ON call_transcripts (call_id);
CREATE INDEX idx_call_transcripts_open ON call_transcripts (status) WHERE status IN ('pending', 'queued');
