/**
 * The agents' priority queue: who to call next.
 *
 * Deliberately not the same list as Admin > Leads (`db/leads.ts`). That one
 * shows every lead the poller pulled in, for a superadmin watching the
 * pipeline. This one shows only leads worth an agent's time - people who
 * replied - ordered so the best one is at the top. DESIGN-PROMPT.md section 2
 * is the screen; QUEUE.md explains the rules.
 */

import { queueTag, type QueueTag } from '../core/queue-tags';
import { pool } from './pool';

export interface QueueRow {
  id: number;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  source: string | null;
  /** When the lead reached us: what the screen's ticking age counts from. */
  receivedAt: string | null;
  score: number;
  tier: string | null;
  /** Their answers, as the choices they picked. The screen maps them to words. */
  q1: string | null;
  q2: string | null;
  q3: string | null;
  conversationStatus: 'open' | 'completed' | 'review' | 'expired';
  tag: QueueTag;
}

export interface QueueQuery {
  tier?: string[];
  source?: string[];
  since?: Date;
  /** Name or phone. */
  q?: string;
  limit?: number;
}

export interface QueuePage {
  leads: QueueRow[];
  /** Per tier plus `all`, ignoring the tier filter, so the header pills keep
   *  their numbers however the tiers are filtered. */
  counts: Record<string, number>;
  /** Every source in view, for the dropdown, ignoring the source filter. */
  sources: string[];
  /** Matching every filter - more than `leads.length` when the limit cut in. */
  total: number;
  limit: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * One row per lead: the newest conversation, the agent holding it, how many
 * calls have been made, and the soonest callback still to be done. Lateral
 * joins rather than group-bys, so history cannot multiply rows.
 */
const BASE = `
  FROM leads l
  JOIN LATERAL (
    SELECT c.status, c.step, c.q1, c.q2, c.q3, c.score, c.tier
    FROM conversations c
    WHERE c.lead_id = l.id
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 1
  ) c ON true
  LEFT JOIN users u ON u.id = l.assigned_to AND u.is_active
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS calls FROM calls ca WHERE ca.lead_id = l.id
  ) ca ON true
  LEFT JOIN LATERAL (
    SELECT cb.scheduled_at
    FROM callbacks cb
    WHERE cb.lead_id = l.id AND cb.done_at IS NULL
    ORDER BY cb.scheduled_at
    LIMIT 1
  ) cb ON true
`;

/**
 * Who belongs in the queue.
 *
 * - **Responders only.** A score above 0 means they have replied at least once;
 *   the queue is for people who showed interest, not everyone the partner sent.
 * - **Never a blocked number**, whatever its conversation says. An opt-out is
 *   absolute, and a live `dnc_list` row is the record of one.
 * - **Not suppressed**, which is the same lead from the conversation's side.
 * - **Not expired** - a conversation that timed out is closed, Jeel's decision
 *   2026-09-19 - *unless* the lead has texted since. That reply is unread and
 *   needs a human, so the lead comes back tagged `inbound_reply` until an agent
 *   opens it. STATE-MACHINE.md, "Expiry".
 */
const INCLUDED = `
  c.score > 0
  AND NOT EXISTS (
    SELECT 1 FROM dnc_list d WHERE d.phone = l.phone AND d.released_at IS NULL
  )
  AND (
    c.status IN ('open', 'completed', 'review')
    OR (c.status = 'expired' AND l.has_unread_inbound)
  )
`;

const RECEIVED = `COALESCE(l.ezt_added_at, l.created_at)`;

/**
 * Escapes what the agent typed for LIKE. Without this a search box holding "%"
 * or "_" is a wildcard and matches leads it has nothing to do with.
 * Backslash is LIKE's own default escape character, so no ESCAPE clause.
 */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function buildFilters(query: QueueQuery, values: unknown[]): string {
  const clauses: string[] = [INCLUDED];

  if (query.tier?.length) {
    values.push(query.tier.map((t) => t.toUpperCase()));
    clauses.push(`c.tier = ANY($${values.length}::text[])`);
  }

  if (query.source?.length) {
    values.push(query.source);
    clauses.push(`l.source = ANY($${values.length}::text[])`);
  }

  if (query.since) {
    values.push(query.since);
    clauses.push(`${RECEIVED} >= $${values.length}`);
  }

  if (query.q) {
    // Phone with punctuation stripped, so "(602) 620-3572" finds +16026203572.
    values.push(`%${likeLiteral(query.q.toLowerCase())}%`);
    const like = `$${values.length}`;
    values.push(`%${query.q.replace(/\D/g, '')}%`);
    const digits = `$${values.length}`;
    clauses.push(`(
      lower(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) LIKE ${like}
      OR (${digits} <> '%%' AND l.phone LIKE ${digits})
    )`);
  }

  return `WHERE ${clauses.join(' AND ')}`;
}

interface QueueDbRow {
  id: number;
  phone: string;
  first_name: string | null;
  last_name: string | null;
  source: string | null;
  received_at: Date | null;
  score: number;
  tier: string | null;
  status: QueueRow['conversationStatus'];
  q1: string | null;
  q2: string | null;
  q3: string | null;
  agent_name: string | null;
  has_unread_inbound: boolean;
  calls: number | null;
  next_callback_at: Date | null;
}

/**
 * The queue, best lead first.
 *
 * Sorted by score, then by how recently the lead arrived: an agent working
 * down the list always has the highest-intent lead in front of them, and
 * between equal scores the freshest one, because speed to contact is the whole
 * point of the screen.
 */
export async function listQueue(query: QueueQuery = {}): Promise<QueuePage> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));

  const values: unknown[] = [];
  const where = buildFilters(query, values);

  const rows = await pool.query<QueueDbRow>(
    `SELECT l.id, l.phone, l.first_name, l.last_name, l.source,
            ${RECEIVED} AS received_at,
            c.score, c.tier, c.status, c.q1, c.q2, c.q3,
            u.name AS agent_name, l.has_unread_inbound,
            ca.calls, cb.scheduled_at AS next_callback_at
     ${BASE}
     ${where}
     ORDER BY c.score DESC, ${RECEIVED} DESC, l.id DESC
     LIMIT ${limit}`,
    values
  );

  // The two option lists are each counted without the filter they drive: the
  // tier pills would zero each other out, and picking a source would leave
  // that source alone in the dropdown with no way back.
  const countValues: unknown[] = [];
  const counts = await pool.query<{ tier: string | null; n: number }>(
    `SELECT c.tier, count(*)::int AS n ${BASE} ${buildFilters({ ...query, tier: undefined }, countValues)} GROUP BY c.tier`,
    countValues
  );

  const sourceValues: unknown[] = [];
  const sources = await pool.query<{ source: string }>(
    `SELECT DISTINCT l.source ${BASE} ${buildFilters({ ...query, source: undefined }, sourceValues)}
       AND l.source IS NOT NULL
     ORDER BY l.source`,
    sourceValues
  );

  const byTier: Record<string, number> = { all: 0 };
  for (const row of counts.rows) {
    if (row.tier) byTier[row.tier] = row.n;
    byTier.all += row.n;
  }

  // How many match everything asked for, which is what the limit truncated.
  // The tier counts already have every other filter applied, so the selected
  // tiers add up to it - no third count query.
  const total = query.tier?.length
    ? query.tier.reduce((sum, t) => sum + (byTier[t.toUpperCase()] ?? 0), 0)
    : byTier.all;

  return {
    leads: rows.rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      firstName: r.first_name,
      lastName: r.last_name,
      source: r.source,
      receivedAt: r.received_at?.toISOString() ?? null,
      score: r.score,
      tier: r.tier,
      q1: r.q1,
      q2: r.q2,
      q3: r.q3,
      conversationStatus: r.status,
      tag: queueTag({
        conversationStatus: r.status,
        answers: [r.q1, r.q2, r.q3],
        assignedAgentName: r.agent_name,
        hasUnreadInbound: r.has_unread_inbound,
        callCount: r.calls ?? 0,
        nextCallbackAt: r.next_callback_at?.toISOString() ?? null,
      }),
    })),
    counts: byTier,
    sources: sources.rows.map((r) => r.source),
    total,
    limit,
  };
}
