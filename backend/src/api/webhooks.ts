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
 * A reply from a phone we hold no lead for - someone texting the number cold,
 * or a lead since deleted. Creating a bare lead and a conversation in `review`
 * puts it in front of a human rather than dropping it. Everything but the
 * phone is unknown.
 */
async function createLeadForUnknownSender(
  client: { query: (q: string, v?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> },
  phone: string
): Promise<number> {
  const lead = await client.query(
    `INSERT INTO leads (phone) VALUES ($1)
     ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
     RETURNING id`,
    [phone]
  );
  const leadId: number = lead.rows[0].id;

  await client.query(
    `INSERT INTO conversations (lead_id, status) VALUES ($1, 'review')`,
    [leadId]
  );

  return leadId;
}

webhooksRouter.post('/eztexting', async (req: Request, res: Response) => {
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

    let leadId: number;
    if (existing.rowCount && existing.rowCount > 0) {
      leadId = existing.rows[0].id;
    } else {
      leadId = await createLeadForUnknownSender(client, phone);
      console.log(`webhook: unknown sender ${phone}, lead ${leadId} created for review`);
    }

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

    if (payload.optOut) {
      await client.query(
        `INSERT INTO dnc_list (phone, reason) VALUES ($1, 'ezt_opt_out')
         ON CONFLICT (phone) DO NOTHING`,
        [phone]
      );
      await client.query(
        `UPDATE conversations SET status = 'suppressed', updated_at = now()
         WHERE lead_id = $1 AND status = 'open'`,
        [leadId]
      );
      console.log(`webhook: ${phone} opted out, suppressed`);
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
});
