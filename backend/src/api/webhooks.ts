import { Request, Response, Router } from 'express';

export const webhooksRouter = Router();

/**
 * Loaded inside the handler rather than at module scope. Both modules pull in
 * src/config, which calls process.exit(1) when a required env var is missing -
 * so importing them at the top would kill any test that builds the app without
 * a full environment. Everything else in the API takes its dependencies through
 * AppDeps for the same reason; this route predates that and reaches for the
 * pool directly.
 */
function deps() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { pool } = require('../db/pool') as typeof import('../db/pool');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { toE164 } = require('../integrations/ezt-client') as typeof import('../integrations/ezt-client');
  return { pool, toE164 };
}

/**
 * Inbound reply from EZ Texting. Payload verified against the live account -
 * see docs/EZTEXTING-API.md.
 *
 * {
 *   "id": "309112289003",          // OUR message being replied to, not an id
 *   "type": "inbound_text.received",
 *   "fromNumber": "16026203572",   // lead's phone, no +
 *   "toNumber": "15207799209",     // our sending number
 *   "message": "3",
 *   "received": "2026-09-14T17:06:31.042+00:00",
 *   "optIn": false,
 *   "optOut": false
 * }
 */
interface InboundText {
  id?: string;
  type?: string;
  fromNumber?: string;
  toNumber?: string;
  message?: string;
  received?: string;
  optIn?: boolean;
  optOut?: boolean;
}

/**
 * Opt-out keywords. EZ Texting sets `optOut` itself, but a reply is checked
 * against these too so a STOP that arrives without the flag still blocks the
 * number. CTIA's standard set.
 */
/** dnc_list.reason for an opt-out that arrived as a reply, vs the poller's `ezt_opt_out`. */
const STOP_REASON = 'sms_stop';

const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke', 'optout']);

function isOptOut(payload: InboundText): boolean {
  if (payload.optOut) return true;
  const text = (payload.message ?? '').trim().toLowerCase().replace(/[.!,]+$/, '');
  return STOP_WORDS.has(text);
}

/** Added without a lead, which the table allows: phone is its only key. */
async function blockNumber(
  client: { query: (q: string, v?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> },
  phone: string,
  reason: string
): Promise<void> {
  await client.query(
    `INSERT INTO dnc_list (phone, reason) VALUES ($1, $2)
     ON CONFLICT (phone) DO NOTHING`,
    [phone, reason]
  );
}

/**
 * EZ Texting sends no signature header, so the caller cannot be verified. The
 * fallback is a random segment in the path, known only to them and us: the
 * subscription is registered against /eztexting/<token>.
 *
 * A wrong token gets 404 rather than 401, so probing the path reveals nothing.
 * When EZT_WEBHOOK_TOKEN is unset the plain path is accepted, which keeps local
 * curl testing simple - production should always set it.
 */
function rejectBadToken(req: Request, res: Response): boolean {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { config } = require('../config') as typeof import('../config');
  const expected = config.ezt.webhookToken;
  const supplied = req.params.token ?? '';

  if (!expected) return false;
  if (supplied === expected) return false;

  console.warn('webhook rejected: bad or missing path token');
  res.status(404).json({ error: 'not_found', message: 'No such endpoint.' });
  return true;
}

const handleInbound = async (req: Request, res: Response) => {
  if (rejectBadToken(req, res)) return;

  const payload = req.body as InboundText;

  // Only inbound replies are handled. Anything else is acknowledged so EZ
  // Texting stops retrying it.
  if (payload?.type !== 'inbound_text.received') {
    console.log(`webhook ignored: type=${payload?.type}`);
    return res.sendStatus(200);
  }

  if (!payload.fromNumber || !payload.received || payload.message === undefined) {
    console.warn('webhook missing fromNumber, received or message');
    return res.sendStatus(200);
  }

  const { pool, toE164 } = deps();
  const phone = toE164(payload.fromNumber);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM leads WHERE phone = $1', [phone]);

    // The subscription is registered per EZ Texting account, not per group or
    // number, so every reply to every campaign on the account arrives here -
    // including the client's own marketing drips, which this app has nothing to
    // do with. A reply from a phone we hold no lead for is therefore not ours:
    // it is ignored rather than turned into a lead. Creating one filled the
    // table with real customer numbers from unrelated campaigns, 34 of them to
    // 1 real lead.
    if (!existing.rowCount) {
      if (isOptOut(payload)) {
        // Kept even though there is no lead. If this number is later delivered
        // as a partner lead, the poller's dnc_list check stops us texting
        // someone who has already opted out of this client's messages.
        await blockNumber(client, phone, STOP_REASON);
      }
      await client.query('COMMIT');
      console.log(
        `webhook: ignored reply from ${phone} - no lead for that number` +
          (isOptOut(payload) ? ', added to dnc_list' : '')
      );
      return res.sendStatus(200);
    }

    const leadId: number = existing.rows[0].id;

    // Dedupe on (from_number, received_at): EZ Texting retries, and the
    // payload's id belongs to our outbound message, so it repeats across
    // replies to the same question.
    const inserted = await client.query(
      `INSERT INTO messages
         (lead_id, direction, body, in_reply_to_ezt_id, from_number, received_at)
       VALUES ($1, 'inbound', $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [leadId, payload.message, payload.id ?? null, payload.fromNumber, payload.received]
    );

    if (inserted.rowCount === 0) {
      await client.query('COMMIT');
      console.log(`webhook: duplicate from ${phone} at ${payload.received}, ignored`);
      return res.sendStatus(200);
    }

    await client.query('UPDATE leads SET has_unread_inbound = true WHERE id = $1', [leadId]);

    if (isOptOut(payload)) {
      await blockNumber(client, phone, STOP_REASON);
      const closed = await client.query(
        `UPDATE conversations SET status = 'suppressed', updated_at = now()
         WHERE lead_id = $1 AND status = 'open'`,
        [leadId]
      );
      // A lead can opt out with no open conversation - already completed, or
      // created by this webhook in `review`. The dnc_list row is what blocks
      // future contact either way, so say which happened rather than implying
      // a conversation changed.
      console.log(
        closed.rowCount
          ? `webhook: ${phone} opted out, open conversation suppressed`
          : `webhook: ${phone} opted out, added to dnc_list (no open conversation)`
      );
    }

    await client.query('COMMIT');

    // TODO (Week 2): run the state machine here - save the answer to q{step},
    // score it, advance or complete, and send the next question.

    return res.sendStatus(200);
  } catch (err) {
    await client.query('ROLLBACK');
    // 500 so EZ Texting retries; the dedupe makes that safe.
    console.error('webhook failed:', err instanceof Error ? err.message : err);
    return res.sendStatus(500);
  } finally {
    client.release();
  }
};

webhooksRouter.post('/eztexting', handleInbound);
webhooksRouter.post('/eztexting/:token', handleInbound);
