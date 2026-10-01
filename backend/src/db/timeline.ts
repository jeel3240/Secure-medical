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

import type { ActivityAction } from '../core/activity';
import { pool } from './pool';

export type TimelineKind =
  | 'system'
  | 'sms'
  | 'inbound'
  | 'agent_sms'
  | 'call'
  | 'note'
  | 'callback'
  | 'disposition'
  /** From the activity log: an action with no row of its own - AUDIT.md. */
  | 'activity';

export interface TimelineEntry {
  kind: TimelineKind;
  at: string;
  /** The agent, where one acted. Null for automated and inbound entries. */
  author: string | null;
  /** Free-form per kind; the screen knows what to read. */
  detail: Record<string, unknown>;
}

/**
 * The activity-log actions the timeline shows: the ones that leave no row in
 * any other table, so the log is the only place they can come from.
 */
const TIMELINE_ACTIONS: ActivityAction[] = [
  'lead.picked_up',
  'lead.released',
  'callback.rescheduled',
  'callback.reopened',
  'sms.blocked',
  'call.refused',
];

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
             c.outcome, c.duration_sec, c.direction
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
  {
    // Only the actions that appear nowhere else. A note, an outcome, a call and
    // a booked callback are already here from their own tables; listing them
    // again from the log would say everything twice.
    kind: 'activity',
    sql: `
      SELECT a.at, u.name AS author, a.action, a.detail, s.name AS subject_name
      FROM activity_log a
      LEFT JOIN users u ON u.id = a.actor_id
      LEFT JOIN users s ON s.id = a.subject_user_id
      WHERE a.lead_id = $1
        AND a.action IN (${TIMELINE_ACTIONS.map((action) => `'${action}'`).join(', ')})
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
 *
 * **A finished conversation is placed at `completed_at`** (migration 004).
 * Placing it at the last inbound reply was only right until the lead texted
 * again: every later "Hi" moved "Scored 60 · completed" down to sit under it -
 * found testing with a real lead, 2026-09-29. The last reply is still used for
 * a conversation that has not finished, where it is what earned the points.
 */
async function systemEvents(leadId: number): Promise<TimelineEntry[]> {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(l.ezt_added_at, l.created_at) AS received_at,
       l.source,
       c.status, c.score, c.tier, c.expires_at, c.agent_took_over_at, c.completed_at,
       (SELECT max(m.received_at) FROM messages m
        WHERE m.lead_id = l.id AND m.direction = 'inbound') AS last_reply_at
     FROM leads l
     LEFT JOIN LATERAL (
       SELECT c.status, c.score, c.tier, c.expires_at, c.agent_took_over_at, c.completed_at
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

  // When the flow finished, if it has; otherwise the reply that earned the
  // points so far.
  const scoredAt: Date | null = r.completed_at ?? r.last_reply_at;
  if (r.score > 0 && r.tier && scoredAt) {
    events.push({
      kind: 'system',
      at: scoredAt.toISOString(),
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

/**
 * A row from any of the five timeline queries. Each fills the columns it has;
 * `at` is always there.
 */
interface TimelineRow {
  at: Date;
  /** Every query selects it: the agent, or null for our own and the lead's. */
  author: string | null;
  /** Messages and calls: which way it went. */
  direction?: 'inbound' | 'outbound';
  sent_by?: number | null;
  body?: string;
  delivery_status?: string | null;
  outcome?: string | null;
  duration_sec?: number | null;
  scheduled_at?: Date | null;
  done_at?: Date | null;
  value?: string;
  action?: string;
  detail?: Record<string, unknown>;
  subject_name?: string | null;
}

function toEntry(kind: TimelineKind, row: TimelineRow): TimelineEntry {
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
        detail: { outcome: row.outcome, durationSec: row.duration_sec, direction: row.direction },
      };
    case 'note':
      return { kind, at, author: row.author, detail: { body: row.body } };
    case 'activity':
      return {
        kind,
        at,
        author: row.author,
        // `subject`: whose claim was released or whose callback was moved, when
        // that is not the person who did it.
        detail: { ...row.detail, action: row.action, subject: row.subject_name ?? null },
      };
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
      const { rows } = await pool.query<TimelineRow>(sql, [leadId]);
      return rows.map((r) => toEntry(kind, r));
    }),
  ]);

  const all = [...system, ...tables.flat()];

  // Ties are common and the order within them matters to how the story reads.
  // "Lead received" comes before the opener it triggered; a reply comes before
  // the score it earned, which shares its timestamp.
  const rank = (e: TimelineEntry): number => {
    if (e.kind === 'system') return e.detail.event === 'lead_received' ? -1 : 6;
    return { inbound: 0, sms: 1, agent_sms: 1, call: 2, note: 3, callback: 4, disposition: 5, activity: 5 }[
      e.kind
    ]!;
  };

  return all.sort((a, b) => {
    const diff = Date.parse(a.at) - Date.parse(b.at);
    return diff !== 0 ? diff : rank(a) - rank(b);
  });
}
