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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { applyReply } = require('./reply-flow') as typeof import('./reply-flow');
  return { pool, toE164, applyReply };
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

/** dnc_list.released_reason when a lead texts START. */
const START_REASON = 'sms_start';

/**
 * Opt-in keywords. EZ Texting re-subscribes the contact on its side and sets
 * `optIn`; the keywords are checked too, so a START that arrives without the
 * flag still lifts our block.
 */
const START_WORDS = new Set(['start', 'unstop', 'yes', 'subscribe']);

const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke', 'optout']);

function normalised(payload: InboundText): string {
  return (payload.message ?? '').trim().toLowerCase().replace(/[.!,]+$/, '');
}

function isOptOut(payload: InboundText): boolean {
  if (payload.optOut) return true;
  return STOP_WORDS.has(normalised(payload));
}

/** A lead asking to hear from us again. Never both: an opt-out wins. */
function isOptIn(payload: InboundText): boolean {
  if (isOptOut(payload)) return false;
  return Boolean(payload.optIn) || START_WORDS.has(normalised(payload));
}

/**
 * Lifts every live block on the number, keeping the row as the record.
 *
 * Every reason is released, including one an agent set - Jeel's decision,
 * 2026-09-22: someone who asks to be contacted again is asking whatever the
 * block was for. The dates stay on the row, so the history reads "blocked on
 * the 22nd, released on the 22nd".
 *
 * Returns how many rows were released, which is 0 when the number was not
 * blocked - a START from someone we never blocked changes nothing.
 */
async function releaseNumber(
  client: { query: (q: string, v?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> },
  phone: string
): Promise<number> {
  const { rowCount } = await client.query(
    `UPDATE dnc_list
     SET released_at = now(), released_reason = $2
     WHERE phone = $1 AND released_at IS NULL`,
    [phone, START_REASON]
  );
  return rowCount ?? 0;
}

/** Added without a lead, which the table allows: phone is its only key. */
async function blockNumber(
  client: { query: (q: string, v?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> },
  phone: string,
  reason: string
): Promise<void> {
  // A number that opted out, was released, and opts out again reuses its row:
  // the block is live again and the release dates are cleared.
  await client.query(
    `INSERT INTO dnc_list (phone, reason) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE
     SET reason = EXCLUDED.reason, added_at = now(),
         released_at = NULL, released_reason = NULL`,
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

  const { pool, toE164, applyReply } = deps();
  const phone = toE164(payload.fromNumber);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id, first_name FROM leads WHERE phone = $1', [
      phone,
    ]);

    // The subscription is registered per EZ Texting account, not per group or
    // number, so every reply to every campaign on the account arrives here -
    // including the client's own marketing drips, which this app has nothing to
    // do with. A reply from a phone we hold no lead for is therefore not ours:
    // it is ignored rather than turned into a lead. Creating one filled the
    // table with real customer numbers from unrelated campaigns, 34 of them to
    // 1 real lead.
    if (!existing.rowCount) {
      // A START from a number we hold no lead for still lifts a block we hold -
      // it may be a lead the partner delivered before, or one still to come.
      if (isOptIn(payload)) {
        const released = await releaseNumber(client, phone);
        await client.query('COMMIT');
        console.log(
          released
            ? `webhook: ${phone} opted back in, block released (no lead)`
            : `webhook: ignored reply from ${phone} - no lead for that number`
        );
        return res.sendStatus(200);
      }

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
    const firstName: string | null = existing.rows[0].first_name ?? null;

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

    const optedOut = isOptOut(payload);

    // START lifts the block first, so anything else in this reply is handled
    // as a normal message. The conversation itself is not reopened: a
    // suppressed one is finished, and what the lead sends next reaches an
    // agent as an inbound reply - STATE-MACHINE.md, "Opting back in".
    if (isOptIn(payload)) {
      const released = await releaseNumber(client, phone);
      if (released) {
        console.log(`webhook: ${phone} opted back in, block released`);
      }
    }

    // The state machine decides what the reply does to the conversation, and
    // what to send. It is told the opt-out outcome rather than parsing the text
    // itself, so the keyword list above stays the only one.
    const pending = await applyReply(client, leadId, phone, firstName, {
      text: payload.message,
      optOut: optedOut,
    });

    // blockNumber is driven by the state machine's result, so the rule lives in
    // one place. A lead with no conversation at all still gets blocked.
    if (pending?.result.blockNumber ?? optedOut) {
      await blockNumber(client, phone, STOP_REASON);
    }

    await client.query('COMMIT');

    if (optedOut) {
      console.log(
        pending?.result.conversation.status === 'suppressed'
          ? `webhook: ${phone} opted out, open conversation suppressed`
          : `webhook: ${phone} opted out, added to dnc_list (no open conversation)`
      );
    }

    // After the commit, deliberately: a failed send must not roll back an
    // answer the lead has already given, and nothing should go out on the back
    // of a transaction that later fails.
    if (pending?.result.send) {
      const sentId = await pending.send();
      const c = pending.result.conversation;
      // Says what actually happened: a send can be refused (dnc_list) or fail
      // while the conversation still advances, and a log line claiming it went
      // out would hide exactly the case worth noticing.
      console.log(
        `webhook: lead ${leadId} -> ${c.status} step=${c.step ?? '-'}` +
          ` score=${c.score} tier=${c.tier ?? '-'}` +
          (sentId ? ` sent=${pending.result.send}` : ` NOT sent=${pending.result.send}`)
      );
    }

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
