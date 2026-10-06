import { blockNumber, DNC_REASONS } from '../db/dnc';
import { openingQuestion, startConversation } from '../db/flows';
import { pool } from '../db/pool';
import { config } from '../config';
import {
  EztContact,
  findGroup,
  isInGroup,
  listContacts,
  toE164,
} from '../integrations/ezt-client';
import { errText, log } from '../lib/log';
import { sendOpener } from './opener';

const CHECKPOINT_KEY = 'ezt_poll_checkpoint';
const PAGE_SIZE = 50;
const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;

export interface PollStats {
  fetched: number;
  inserted: number;
  skipped: number;
  suppressed: number;
  openersSent: number;
  durationMs: number;
}

async function readCheckpoint(): Promise<Date> {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [CHECKPOINT_KEY]);
  const stored = rows.length > 0 ? new Date(rows[0].value) : null;
  // Absent, or not a date: look back an hour. Every poll now writes the
  // checkpoint back, so an unreadable one must not stop the poller cold.
  if (!stored || Number.isNaN(stored.getTime())) {
    return new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  }
  return stored;
}

async function writeCheckpoint(at: Date): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [CHECKPOINT_KEY, at.toISOString()]
  );
}

async function readSetting(key: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length > 0 ? rows[0].value : null;
}

async function readOverlapMs(): Promise<number> {
  const raw = await readSetting('poll_overlap_minutes');
  const minutes = raw !== null ? Number(raw) : 5;
  return (Number.isFinite(minutes) ? minutes : 5) * 60 * 1000;
}

function assertNewestFirst(contacts: EztContact[]): void {
  for (let i = 1; i < contacts.length; i++) {
    const prev = Date.parse(contacts[i - 1].createdAt);
    const curr = Date.parse(contacts[i].createdAt);
    if (curr > prev) {
      throw new Error(
        'EZ Texting returned contacts oldest-first; expected sort=createdAt,desc. ' +
          'Refusing to poll, since the checkpoint logic depends on newest-first order.'
      );
    }
  }
}

async function isOnDnc(phone: string): Promise<boolean> {
  // Released rows are history, not a block - see 002_dnc_release.sql.
  const { rowCount } = await pool.query(
    'SELECT 1 FROM dnc_list WHERE phone = $1 AND released_at IS NULL',
    [phone]
  );
  return rowCount! > 0;
}

/**
 * Inserts the lead and its conversation together. Returns null when the phone
 * is already known, which is how a re-poll of the overlap window stays a no-op.
 *
 * TODO (Phase 2): returning leads. Dropping every known phone is wrong for a
 * lead that comes back months later. The poller should instead decide per
 * contact:
 *
 *   a. optOut, or phone on dnc_list  -> save as suppressed, send nothing, stop
 *   b. phone not in our DB           -> create lead + conversation (open,
 *                                       step 1), send opener
 *   c. phone already in our DB       -> look at its newest conversation:
 *        open       -> already in the pipeline, do nothing
 *        completed  -> new conversation, send opener
 *        expired    -> new conversation, send opener
 *        suppressed -> never text, whatever else is true
 *
 * That means keeping leads.phone unique, allowing many conversations per lead,
 * and dropping previous_lead_id - "seen before" in the queue is then derived
 * from the prior conversations. Blocked on Jim confirming whether a
 * re-delivered phone arrives as a new EZ Texting contact or an update to the
 * existing one, since that decides whether createdAt moves and the poller sees
 * it at all. Wire it with the state machine.
 *
 * expires_at is set by sendOpener (worker/opener.ts) rather than here, because it is the window
 * the lead has to reply to a message - a conversation whose opener failed has
 * not started one. The expiry sweep falls back to created_at for those.
 */
async function insertLead(
  contact: EztContact,
  phone: string,
  status: 'open' | 'suppressed',
  /** EZ Texting has the contact opted out and we hold no live block for it: block it. */
  blockAsOptedOut = false
): Promise<number | null> {
  const group = findGroup(contact, config.ezt.group);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const lead = await client.query(
      `INSERT INTO leads (phone, first_name, last_name, email, source, group_id, group_name, ezt_added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (phone) DO NOTHING
       RETURNING id`,
      [
        phone,
        contact.firstName ?? null,
        contact.lastName ?? null,
        contact.email ?? null,
        contact.source ?? null,
        group?.id ?? null,
        group?.name ?? null,
        contact.createdAt,
      ]
    );

    if (lead.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const leadId: number = lead.rows[0].id;

    // In the flow new leads get, on its first question - db/flows.ts.
    await startConversation(client, leadId, status);

    // Through db/dnc.ts, like every other block - Jeel, 2026-10-01. Until then
    // this was the poller's own insert, `ON CONFLICT DO NOTHING`, which wrote no
    // `dnc.blocked` record (docs/AUDIT.md: nothing may be lost) and left a
    // number released by START unblocked when EZ Texting delivered it opted out
    // again. In the lead's own transaction, so the lead, its suppressed
    // conversation, the block and its record commit together.
    //
    // Only when the number is not already blocked: a live block has its own
    // reason and record, and re-blocking would overwrite the reason with ours.
    if (blockAsOptedOut) {
      await blockNumber(client, phone, DNC_REASONS.eztOptOut);
    }

    await client.query('COMMIT');
    return leadId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sends question 1 to a newly created lead and records it - `worker/opener.ts`.
 *
 * The returned id goes in messages.ezt_message_id, which is what an inbound
 * reply's `id` field points back at - that is how a reply is tied to the
 * question it answers.
 *
 * A failure here is logged and swallowed: the lead is already committed, and
 * throwing would abandon the rest of the page and leave the checkpoint behind,
 * so every later contact would be re-polled because one send failed. The
 * refused opener is kept as a failed message, so the lead's thread shows it
 * with a red "!" - `db/failed-sends.ts`.
 */
async function openLead(leadId: number, phone: string, firstName: string | null): Promise<boolean> {
  try {
    // The first question of the lead's flow - docs/FLOWS.md.
    const template = await openingQuestion(pool, leadId);
    if (!template) {
      log.error('sms.no_template', { leadId, key: 'question_1' });
      return false;
    }

    const result = await sendOpener({ id: leadId, phone, firstName }, template);
    if (!result.sent) {
      log.error('sms.failed', { leadId, key: 'question_1', blocked: result.blocked, err: errText(result.err) });
      return false;
    }

    log.info('sms.sent', { leadId, key: 'question_1', eztMessageId: result.eztMessageId });
    return true;
  } catch (err) {
    // Before the send, or after it went out (the reply window). Either way
    // nothing is marked refused, so the retry cannot send the opener twice.
    log.error('sms.failed', { leadId, key: 'question_1', err: errText(err) });
    return false;
  }
}

/**
 * One poll cycle: page through the group newest-first, stopping once contacts
 * predate the checkpoint's overlap window.
 *
 * The checkpoint advances to the newest createdAt actually seen, and only if
 * the whole cycle succeeded - a throw here leaves it untouched so the next
 * run re-covers the same ground.
 */
export async function pollOnce(): Promise<PollStats> {
  const startedAt = Date.now();
  const groupName = config.ezt.group;

  const checkpoint = await readCheckpoint();
  const cutoff = new Date(checkpoint.getTime() - (await readOverlapMs()));

  const stats: PollStats = {
    fetched: 0,
    inserted: 0,
    skipped: 0,
    suppressed: 0,
    openersSent: 0,
    durationMs: 0,
  };
  let newest: Date | null = null;
  let page = 0;
  let reachedCutoff = false;

  while (!reachedCutoff) {
    const result = await listContacts({
      groupName,
      page,
      size: PAGE_SIZE,
      source: config.ezt.source,
    });
    stats.fetched += result.content.length;

    // An unrecognised sort field is ignored rather than rejected, and the
    // default order is oldest-first - which would make the loop below break on
    // the first contact every tick and never see anything new. Fail loudly
    // instead: the checkpoint is not advanced, so nothing is lost.
    assertNewestFirst(result.content);

    for (const contact of result.content) {
      const addedAt = new Date(contact.createdAt);

      if (addedAt <= cutoff) {
        reachedCutoff = true;
        break;
      }
      if (!newest || addedAt > newest) {
        newest = addedAt;
      }

      // `like` also matches "weightloss - sent", so confirm real membership.
      if (!isInGroup(contact, groupName)) {
        stats.skipped += 1;
        continue;
      }

      const phone = toE164(contact.phoneNumber);

      // TODO (Phase 2): this branches on optOut vs not. It needs a third case
      // for a phone we already hold, keyed on that lead's newest conversation
      // status - see the note on insertLead.
      const alreadyBlocked = await isOnDnc(phone);
      if (contact.optOut || alreadyBlocked) {
        const leadId = await insertLead(contact, phone, 'suppressed', Boolean(contact.optOut) && !alreadyBlocked);
        if (leadId === null) {
          stats.skipped += 1;
        } else {
          stats.suppressed += 1;
        }
        continue;
      }

      const leadId = await insertLead(contact, phone, 'open');
      if (leadId === null) {
        stats.skipped += 1;
      } else {
        stats.inserted += 1;
        if (await openLead(leadId, phone, contact.firstName ?? null)) {
          stats.openersSent += 1;
        }
      }
    }

    if (result.last) break;
    page += 1;
  }

  // A quiet poll still writes the checkpoint - the same value, a fresh
  // updated_at. That time is what Admin > Leads' "Synced" line and the health
  // check read as "the worker last polled"; written only when a new contact
  // arrived, it stood still on a quiet account and both reported a healthy
  // worker as stopped. Jeel, 2026-09-28.
  await writeCheckpoint(newest ?? checkpoint);

  stats.durationMs = Date.now() - startedAt;
  return stats;
}
