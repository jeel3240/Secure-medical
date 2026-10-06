-- Two lookups the queue and Admin > Leads make for every lead, on every
-- refresh, that had no index - found 2026-10-06 by timing both screens against
-- 50,000 leads. docs/QUEUE.md, "How fast it is".
--
-- "Has a callback been booked since this lead was closed?" (db/lead-state.ts,
-- CLOSED_SQL) read the whole of `callbacks` once per closed lead: the only
-- indexes were by agent, and by lead for open missed-call ones. It was most of
-- the queue's time.
CREATE INDEX idx_callbacks_lead_id ON callbacks (lead_id);

-- "Has an agent texted this lead?" - what makes a lead read Working, and what
-- settles a missed call. Agents' own texts are a small part of `messages`;
-- without this the whole table was read to find that a lead had none.
CREATE INDEX idx_messages_agent_sent ON messages (lead_id) WHERE sent_by IS NOT NULL;

-- Admin > Leads lists leads newest first, by when they reached us. Nothing
-- was indexed on that expression, so every page sorted every lead - on disk,
-- past a few tens of thousands. With it, an unfiltered page reads only its
-- own fifty rows.
CREATE INDEX idx_leads_received ON leads ((COALESCE(ezt_added_at, created_at)) DESC, id DESC);
