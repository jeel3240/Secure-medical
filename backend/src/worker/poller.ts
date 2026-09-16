import { pool } from '../db/pool';
import { config } from '../config';
import { renderMessage } from '../core/messages';
import {
  EztContact,
  findGroup,
  isInGroup,
  listContacts,
  sendMessage,
  toE164,
} from '../integrations/ezt-client';

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
  if (rows.length === 0) {
    return new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  }
  return new Date(rows[0].value);
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
  const { rowCount } = await pool.query('SELECT 1 FROM dnc_list WHERE phone = $1', [phone]);
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
 * TODO (Phase 2): expires_at is never set on the conversation created below,
 * so nothing can auto-expire. Set it to now + expiry_days (from settings) at
 * creation. Wire it with the state machine.
 */
async function insertLead(
  contact: EztContact,
  phone: string,
  status: 'open' | 'suppressed'
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

    await client.query(
      `INSERT INTO conversations (lead_id, status, step) VALUES ($1, $2, $3)`,
      [leadId, status, status === 'open' ? 1 : null]
    );

    if (status === 'suppressed') {
      await client.query(
        `INSERT INTO dnc_list (phone, reason) VALUES ($1, 'ezt_opt_out')
         ON CONFLICT (phone) DO NOTHING`,
        [phone]
      );
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
 * Sends question 1 to a newly created lead and records it.
 *
 * The returned id goes in messages.ezt_message_id, which is what an inbound
 * reply's `id` field points back at - that is how a reply is tied to the
 * question it answers.
 *
 * A failure here is logged and swallowed: the lead is already committed, and
 * throwing would abandon the rest of the page and leave the checkpoint behind,
 * so every later contact would be re-polled because one send failed. The lead
 * simply has no opener, which is visible as a conversation with no outbound
 * message.
 */
async function sendOpener(leadId: number, phone: string, firstName: string | null): Promise<boolean> {
  try {
    const template = await readSetting('question_1');
    if (!template) {
      console.error('no question_1 in settings, opener not sent');
      return false;
    }

    // The stored copy carries {first_name}; what goes out, and what is recorded
    // in messages.body, is the rendered text.
    const { text, nameDropped } = renderMessage(template, firstName);
    if (nameDropped) {
      console.log(`opener for lead ${leadId}: name dropped to stay within one segment`);
    }

    const result = await sendMessage([phone], text);

    await pool.query(
      `INSERT INTO messages (lead_id, direction, body, ezt_message_id)
       VALUES ($1, 'outbound', $2, $3)`,
      [leadId, text, result.id]
    );

    console.log(`opener sent to lead ${leadId}, ezt id ${result.id}`);
    return true;
  } catch (err) {
    const detail =
      (err as { response?: { data?: unknown } })?.response?.data ??
      (err instanceof Error ? err.message : err);
    console.error(`opener failed for lead ${leadId}:`, JSON.stringify(detail));
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
      if (contact.optOut || (await isOnDnc(phone))) {
        const leadId = await insertLead(contact, phone, 'suppressed');
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
        if (await sendOpener(leadId, phone, contact.firstName ?? null)) {
          stats.openersSent += 1;
        }
      }
    }

    if (result.last) break;
    page += 1;
  }

  if (newest) {
    await writeCheckpoint(newest);
  }

  stats.durationMs = Date.now() - startedAt;
  return stats;
}
