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
import { CLOSED_SQL } from './lead-state';
import { likeLiteral } from './sql';
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
  /** `null` when there is nothing to say: the lead is waiting to be picked up. */
  tag: QueueTag | null;
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
 * One row per lead: the newest conversation and the agent holding it. A
 * lateral join rather than a group-by, so history cannot multiply rows.
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
`;

/**
 * Who belongs in the queue: only leads that need a person - Jeel, 2026-09-28.
 *
 * It used to hold every responder, including a lead halfway through the
 * questions. But question 3 asks how they want to be contacted, so a lead who
 * has not reached it has not asked for a call - and one still answering would
 * be interrupted by it. A lead is in when it has replied (a score above 0), its
 * number is not blocked (a live `dnc_list` row, whatever the conversation
 * says), and one of these holds:
 *
 * - **Completed** - answered all three, including how to contact them.
 * - **Needs review** - replied, and we could not understand it.
 * - **Inbound reply** - texted something the questions cannot handle: after
 *   the conversation ended, or to an agent who took it over. Since the same day
 *   that is exactly what `has_unread_inbound` means - STATE-MACHINE.md, rules 2
 *   and 2b - so the flag can stand on its own here.
 * - **Being worked** - an active agent holds it, or a callback is booked. A
 *   lead must never vanish from under the agent working it, whatever its
 *   conversation says.
 *
 * **A closed lead leaves** - Jeel, 2026-09-28. Once an agent has pressed
 * Closed (`db/lead-state.ts`), completing the questions, needing review or an
 * older callback no longer keeps it here. Two things still do: an agent
 * holding it, so it does not vanish while they save and move on; and a new
 * message from the lead, which a person must read. A callback booked after
 * closing reopens the lead altogether.
 *
 * A lead partway through the questions is on Admin > Leads only.
 */
const INCLUDED = `
  c.score > 0
  AND NOT EXISTS (
    SELECT 1 FROM dnc_list d WHERE d.phone = l.phone AND d.released_at IS NULL
  )
  AND (
    u.id IS NOT NULL
    OR l.has_unread_inbound
    OR (
      NOT ${CLOSED_SQL}
      AND (
        c.status IN ('completed', 'review')
        OR EXISTS (
          SELECT 1 FROM callbacks cb WHERE cb.lead_id = l.id AND cb.done_at IS NULL
        )
      )
    )
  )
`;

const RECEIVED = `COALESCE(l.ezt_added_at, l.created_at)`;

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
            u.name AS agent_name, l.has_unread_inbound
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
        assignedAgentName: r.agent_name,
        hasUnreadInbound: r.has_unread_inbound,
      }),
    })),
    counts: byTier,
    sources: sources.rows.map((r) => r.source),
    total,
    limit,
  };
}
