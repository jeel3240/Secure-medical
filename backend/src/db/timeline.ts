/**
 * The lead timeline: one ordered list built from `messages`, `calls`, `notes`,
 * `callbacks` and `dispositions`, plus system events that are derived rather
 * than stored.
 *
 * Oldest first, as the screen renders it. Each entry carries a `kind`, a
 * timestamp, an author where there is one, and its own fields; the screen
 * decides icons and wording, the way it does for queue tags.
 *
 * AGENT-WORKSPACE.md, "The timeline"; DESIGN-PROMPT.md section 3.
 */

import { pool } from './pool';

export type TimelineKind =
  | 'system'
  | 'sms'
  | 'inbound'
  | 'agent_sms'
  | 'call'
  | 'note'
  | 'callback'
  | 'disposition';

export interface TimelineEntry {
  kind: TimelineKind;
  at: string;
  /** The agent, where one acted. Null for automated and inbound entries. */
  author: string | null;
  /** Free-form per kind; the screen knows what to read. */
  detail: Record<string, unknown>;
}

/**
 * Rows from the five tables. Each query returns the same shape so they can be
 * merged without special-casing, and each is indexed on `lead_id`.
 */
const QUERIES: { kind: TimelineKind; sql: string }[] = [
  {
    // Outbound splits on sent_by: null is one of ours, an id is an agent's.
    // Nothing writes it yet - agent SMS is task 9 - so every outbound row is
    // automated today, and this is ready for when that changes.
    kind: 'sms',
    sql: `
      SELECT m.created_at AS at,
             u.name AS author,
             m.direction, m.body, m.delivery_status, m.sent_by
      FROM messages m
      LEFT JOIN users u ON u.id = m.sent_by
      WHERE m.lead_id = $1
    `,
  },
  {
    kind: 'call',
    sql: `
      SELECT COALESCE(c.started_at, c.created_at) AS at,
             u.name AS author,
             c.outcome, c.duration_sec
      FROM calls c
      LEFT JOIN users u ON u.id = c.agent_id
      WHERE c.lead_id = $1
    `,
  },
  {
    kind: 'note',
    sql: `
      SELECT n.created_at AS at, u.name AS author, n.body
      FROM notes n
      LEFT JOIN users u ON u.id = n.agent_id
      WHERE n.lead_id = $1
    `,
  },
  {
    kind: 'callback',
    sql: `
      SELECT cb.created_at AS at, u.name AS author,
             cb.scheduled_at, cb.done_at
      FROM callbacks cb
      LEFT JOIN users u ON u.id = cb.agent_id
      WHERE cb.lead_id = $1
    `,
  },
  {
    kind: 'disposition',
    sql: `
      SELECT d.created_at AS at, u.name AS author, d.value
      FROM dispositions d
      LEFT JOIN users u ON u.id = d.agent_id
      WHERE d.lead_id = $1
    `,
  },
];

const iso = (v: Date | null | undefined): string | null => v?.toISOString() ?? null;

/**
 * The events that have no table.
 *
 * "Lead received" is the only one with a timestamp of its own. The other two
 * are placed at the moment that caused them: a conversation carries its score
 * and status but no record of when it reached them, and `updated_at` moves on
 * every change, so it cannot be used. The last inbound reply is what earned the
 * final points, and `expires_at` is when the conversation lapsed - both are
 * accurate and already recorded.
 *
 * An event with no timestamp to stand on is left out rather than guessed at.
 */
async function systemEvents(leadId: number): Promise<TimelineEntry[]> {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(l.ezt_added_at, l.created_at) AS received_at,
       l.source,
       c.status, c.score, c.tier, c.expires_at, c.agent_took_over_at,
       (SELECT max(m.received_at) FROM messages m
        WHERE m.lead_id = l.id AND m.direction = 'inbound') AS last_reply_at
     FROM leads l
     LEFT JOIN LATERAL (
       SELECT c.status, c.score, c.tier, c.expires_at, c.agent_took_over_at
       FROM conversations c
       WHERE c.lead_id = l.id
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT 1
     ) c ON true
     WHERE l.id = $1`,
    [leadId]
  );

  if (rows.length === 0) return [];
  const r = rows[0];
  const events: TimelineEntry[] = [];

  if (r.received_at) {
    events.push({
      kind: 'system',
      at: r.received_at.toISOString(),
      author: null,
      detail: { event: 'lead_received', source: r.source },
    });
  }

  // Placed at the reply that earned the points, because nothing records when
  // the score was reached.
  if (r.score > 0 && r.tier && r.last_reply_at) {
    events.push({
      kind: 'system',
      at: r.last_reply_at.toISOString(),
      author: null,
      detail: { event: 'scored', score: r.score, tier: r.tier, status: r.status },
    });
  }

  if (r.agent_took_over_at) {
    events.push({
      kind: 'system',
      at: r.agent_took_over_at.toISOString(),
      author: null,
      detail: { event: 'agent_took_over' },
    });
  }

  // Only when it actually expired: expires_at is set on every send, so a live
  // conversation has a future one that has not happened yet.
  if (r.status === 'expired' && r.expires_at) {
    events.push({
      kind: 'system',
      at: r.expires_at.toISOString(),
      author: null,
      detail: { event: 'conversation_expired' },
    });
  }

  return events;
}

function toEntry(kind: TimelineKind, row: Record<string, any>): TimelineEntry {
  const at: string = row.at.toISOString();

  switch (kind) {
    case 'sms': {
      const inbound = row.direction === 'inbound';
      return {
        // Three kinds come out of one table: a reply, one of our automated
        // sends, or an agent's manual message.
        kind: inbound ? 'inbound' : row.sent_by ? 'agent_sms' : 'sms',
        at,
        author: inbound ? null : row.author,
        detail: inbound
          ? { body: row.body }
          : { body: row.body, deliveryStatus: row.delivery_status },
      };
    }
    case 'call':
      return {
        kind,
        at,
        author: row.author,
        detail: { outcome: row.outcome, durationSec: row.duration_sec },
      };
    case 'note':
      return { kind, at, author: row.author, detail: { body: row.body } };
    case 'callback':
      return {
        kind,
        at,
        author: row.author,
        detail: { scheduledAt: iso(row.scheduled_at), doneAt: iso(row.done_at) },
      };
    case 'disposition':
      return { kind, at, author: row.author, detail: { value: row.value } };
    default:
      return { kind, at, author: null, detail: {} };
  }
}

/**
 * Null when there is no such lead, so the route can tell that apart from a lead
 * with no history yet - both would otherwise be an empty list.
 */
export async function getTimeline(leadId: number): Promise<TimelineEntry[] | null> {
  const { rowCount } = await pool.query(`SELECT 1 FROM leads WHERE id = $1`, [leadId]);
  if (rowCount === 0) return null;

  return buildTimeline(leadId);
}

async function buildTimeline(leadId: number): Promise<TimelineEntry[]> {
  const [system, ...tables] = await Promise.all([
    systemEvents(leadId),
    ...QUERIES.map(async ({ kind, sql }) => {
      const { rows } = await pool.query(sql, [leadId]);
      return rows.map((r) => toEntry(kind, r));
    }),
  ]);

  const all = [...system, ...tables.flat()];

  // Ties are common and the order within them matters to how the story reads.
  // "Lead received" comes before the opener it triggered; a reply comes before
  // the score it earned, which shares its timestamp.
  const rank = (e: TimelineEntry): number => {
    if (e.kind === 'system') return e.detail.event === 'lead_received' ? -1 : 6;
    return { inbound: 0, sms: 1, agent_sms: 1, call: 2, note: 3, callback: 4, disposition: 5 }[
      e.kind
    ]!;
  };

  return all.sort((a, b) => {
    const diff = Date.parse(a.at) - Date.parse(b.at);
    return diff !== 0 ? diff : rank(a) - rank(b);
  });
}
