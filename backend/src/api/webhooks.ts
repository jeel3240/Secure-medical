import { Request, Response, Router } from 'express';
// Safe at module scope: db/dnc.ts imports nothing, taking its client as an
// argument, so it does not drag in src/config the way db/pool does.
import { archiveWebhook } from '../db/activity';
import { blockNumber, DNC_REASONS, releaseNumber } from '../db/dnc';
import { errText, log } from '../lib/log';
import { asyncHandler } from './http';

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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pool } = require('../db/pool') as typeof import('../db/pool');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toE164 } = require('../integrations/ezt-client') as typeof import('../integrations/ezt-client');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
const STOP_REASON = DNC_REASONS.smsStop;

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
 * EZ Texting sends no signature header, so the caller cannot be verified. The
 * fallback is a random segment in the path, known only to them and us: the
 * subscription is registered against /eztexting/<token>.
 *
 * A wrong token gets 404 rather than 401, so probing the path reveals nothing.
 * When EZT_WEBHOOK_TOKEN is unset the plain path is accepted, which keeps local
 * curl testing simple - production should always set it.
 */
function rejectBadToken(req: Request, res: Response): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require('../config') as typeof import('../config');
  const expected = config.ezt.webhookToken;
  const supplied = req.params.token ?? '';

  if (!expected) return false;
  if (supplied === expected) return false;

  log.warn('webhook.rejected', { reason: 'bad_token' });
  res.status(404).json({ error: 'not_found', message: 'No such endpoint.' });
  return true;
}

const handleInbound = async (req: Request, res: Response) => {
  if (rejectBadToken(req, res)) return;

  const payload = req.body as InboundText;

  // Kept exactly as it arrived, before anything is decided about it and
  // outside the transaction below, so a request we go on to ignore - or fail
  // on - is still on record. A failure here is a 500, which EZ Texting
  // retries. AUDIT.md.
  await archiveWebhook(deps().pool, { source: 'eztexting', path: '/api/webhooks/eztexting', payload });

  // Only inbound replies are handled. Anything else is acknowledged so EZ
  // Texting stops retrying it.
  if (payload?.type !== 'inbound_text.received') {
    log.info('webhook.ignored', { reason: 'wrong_type', type: payload?.type });
    return res.sendStatus(200);
  }

  if (!payload.fromNumber || !payload.received || payload.message === undefined) {
    log.warn('webhook.ignored', { reason: 'missing_fields' });
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
        log.info(released ? 'dnc.released' : 'webhook.ignored', {
          reason: released ? undefined : 'no_lead',
          hasLead: false,
        });
        return res.sendStatus(200);
      }

      if (isOptOut(payload)) {
        // Kept even though there is no lead. If this number is later delivered
        // as a partner lead, the poller's dnc_list check stops us texting
        // someone who has already opted out of this client's messages.
        await blockNumber(client, phone, STOP_REASON);
      }
      await client.query('COMMIT');
      log.info('webhook.ignored', {
        reason: 'no_lead',
        blocked: isOptOut(payload) || undefined,
      });
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
      log.info('webhook.ignored', { reason: 'duplicate', leadId });
      return res.sendStatus(200);
    }

    const optedOut = isOptOut(payload);

    // START lifts the block first, so anything else in this reply is handled
    // as a normal message. The conversation itself is not reopened: a
    // suppressed one is finished, and what the lead sends next reaches an
    // agent as an inbound reply - STATE-MACHINE.md, "Opting back in".
    if (isOptIn(payload)) {
      const released = await releaseNumber(client, phone);
      if (released) {
        log.info('dnc.released', { leadId });
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

    // Flag the lead only when a person has to read this - Jeel, 2026-09-28.
    // The flag is the queue's Inbound reply, and it used to be set on every
    // reply, so a lead simply answering "1" read as one. The state machine
    // decides: a message after the conversation ended, or to an agent who took
    // it over. A lead with no conversation has nothing handling their message
    // either. An opt-out never needs one - the block is the whole response.
    const needsPerson = !optedOut && (pending === null || pending.result.needsPerson);
    if (needsPerson) {
      await client.query('UPDATE leads SET has_unread_inbound = true WHERE id = $1', [leadId]);
    }

    await client.query('COMMIT');

    if (optedOut) {
      log.info('dnc.blocked', {
        leadId,
        suppressed: pending?.result.conversation.status === 'suppressed',
      });
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
      log.info('conversation.advanced', {
        leadId,
        status: c.status,
        step: c.step,
        score: c.score,
        tier: c.tier,
        send: pending.result.send,
        // A send can be refused (dnc_list) or fail while the conversation still
        // advances; a line claiming it went out would hide the case worth seeing.
        sent: Boolean(sentId),
      });
    }

    return res.sendStatus(200);
  } catch (err) {
    await client.query('ROLLBACK');
    // 500 so EZ Texting retries; the dedupe makes that safe.
    log.error('webhook.failed', { err: errText(err) });
    return res.sendStatus(500);
  } finally {
    client.release();
  }
};

// Wrapped like every other route. `pool.connect()` runs before the handler's own
// try, so a database blip used to be an unhandled rejection - which in Node 20
// takes the whole API process down. Now it is a 500, which EZ Texting retries,
// and the dedupe makes the retry safe. Found 2026-09-28.
webhooksRouter.post('/eztexting', asyncHandler(handleInbound));
webhooksRouter.post('/eztexting/:token', asyncHandler(handleInbound));
